package backup

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"
)

// Command streams large exports to disk; it never buffers an entire database.
type Command func(context.Context, string, []string, []string, string, io.Writer) error

var ErrBusy = errors.New("another backup operation is running")

type Worker struct {
	Home, State, HelperImage string
	Now                      func() time.Time
	Command                  Command
}

func New(home, state string) *Worker {
	image := os.Getenv("KIMONO_BACKUP_HELPER_IMAGE")
	if image == "" {
		image = "ghcr.io/kimonoapps/kimono-reconciler:latest"
	}
	return &Worker{Home: home, State: state, HelperImage: image, Now: time.Now, Command: execute}
}

func execute(ctx context.Context, name string, args, env []string, dir string, out io.Writer) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = out
	// Commands receive only their explicit environment plus ordinary process
	// settings. Never inherit a RESTIC_PASSWORD_COMMAND or an alternate backend.
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + os.Getenv("HOME"), "LANG=C.UTF-8"}
	cmd.Env = append(cmd.Env, env...)
	cmd.Stderr = io.Discard // Credentials and application data must not reach logs.
	return cmd.Run()
}
func (w *Worker) dir() string        { return filepath.Join(w.State, "backups") }
func (w *Worker) statusPath() string { return filepath.Join(w.dir(), "status.json") }
func (w *Worker) loadConfig() (Config, error) {
	var c Config
	err := readJSON(filepath.Join(w.dir(), "config.json"), &c)
	if err == nil {
		err = c.Validate()
	}
	return c, err
}
func (w *Worker) saveStatus(s *Status) error {
	s.UpdatedAt = w.Now().UTC().Format(time.RFC3339)
	return writeJSON(w.statusPath(), s, 0644)
}

// Tick is called by the reconciler in the same goroutine as deployment, so an
// update cannot replace a container halfway through its database export.
func (w *Worker) Tick(ctx context.Context) error {
	if _, err := os.Stat(filepath.Join(w.dir(), "config.json")); os.IsNotExist(err) {
		return nil
	}
	err := w.locked(func() error {
		var status Status
		_ = readJSON(w.statusPath(), &status)
		// No lock holder survives a process crash. Mark an interrupted operation as
		// failed before accepting another request; never leave a permanent spinner.
		if status.State == "running" {
			status.State = "failed"
			status.Message = "The previous backup operation was interrupted. It will be retried on schedule."
			if err := w.saveStatus(&status); err != nil {
				return err
			}
		}
		var request Request
		requestPath := filepath.Join(w.dir(), "request.json")
		err := readJSON(requestPath, &request)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		config, configErr := w.loadConfig()
		if configErr != nil {
			if err == nil || config.Enabled {
				status.State = "failed"
				status.Message = configErr.Error()
				return w.saveStatus(&status)
			}
			return nil
		}
		if os.IsNotExist(err) {
			if !Due(config, status, w.Now()) {
				return nil
			}
			request = Request{Action: "backup"}
		} else if err := os.Remove(requestPath); err != nil {
			return err
		}
		return w.perform(ctx, config, request, &status)
	})
	if errors.Is(err, ErrBusy) {
		return nil
	}
	return err
}

// Run is the recovery/administration CLI entry point, sharing the daemon lock.
func (w *Worker) Run(ctx context.Context, request Request) error {
	return w.locked(func() error {
		config, err := w.loadConfig()
		if err != nil {
			return err
		}
		var status Status
		_ = readJSON(w.statusPath(), &status)
		return w.perform(ctx, config, request, &status)
	})
}
func (w *Worker) locked(fn func() error) error {
	if err := os.MkdirAll(w.dir(), 0700); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(w.dir(), "worker.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return ErrBusy
		}
		return err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}
func (w *Worker) perform(ctx context.Context, c Config, r Request, s *Status) (result error) {
	if r.Action != "backup" && r.Action != "check" && r.Action != "restore" {
		return fmt.Errorf("unknown backup action")
	}
	if r.Action == "restore" && (!snapshotID.MatchString(r.Snapshot) || (r.AppID != "" && !slug.MatchString(r.AppID))) {
		return fmt.Errorf("invalid restore selection")
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Hour)
	defer cancel()
	s.State = "running"
	s.Message = map[string]string{"backup": "Exporting and encrypting selected data; apps stay online.", "check": "Checking repository integrity and reading stored data.", "restore": "Restoring a verified copy into a separate recovery directory."}[r.Action]
	if r.Action == "backup" {
		s.LastAttempt = w.Now().UTC().Format(time.RFC3339)
	}
	if err := w.saveStatus(s); err != nil {
		return err
	}
	defer func() {
		if result != nil {
			s.State = "failed"
			s.Message = result.Error()
		} else {
			s.State = "ready"
		}
		if err := w.saveStatus(s); result == nil {
			result = err
		}
	}()
	if err := w.repository(ctx, c, r.Action == "backup"); err != nil {
		return err
	}
	switch r.Action {
	case "backup":
		if err := w.backup(ctx, c); err != nil {
			return err
		}
		s.LastSuccess = w.Now().UTC().Format(time.RFC3339)
		// Prune only after a complete snapshot. Never expire snapshots on an export
		// failure or restic's partial-backup exit code 3.
		if err := w.restic(ctx, c, io.Discard, "forget", "--tag", "kimono", "--group-by", "host", "--keep-daily", fmt.Sprint(c.Daily), "--keep-weekly", fmt.Sprint(c.Weekly), "--keep-monthly", fmt.Sprint(c.Monthly), "--prune"); err != nil {
			return fmt.Errorf("backup saved, but retention failed: %w", err)
		}
		lastCheck, _ := time.Parse(time.RFC3339, s.LastCheck)
		if w.Now().Sub(lastCheck) >= 7*24*time.Hour {
			if err := w.restic(ctx, c, io.Discard, "check", "--read-data-subset=5%"); err != nil {
				return fmt.Errorf("backup saved, but integrity check failed: %w", err)
			}
			s.LastCheck = w.Now().UTC().Format(time.RFC3339)
		}
		s.Message = "Encrypted backup completed. Apps remained online."
	case "check":
		if err := w.restic(ctx, c, io.Discard, "check", "--read-data"); err != nil {
			return fmt.Errorf("repository integrity check failed: %w", err)
		}
		s.LastCheck = w.Now().UTC().Format(time.RFC3339)
		s.Message = "All repository data passed its integrity check."
	case "restore":
		if r.AppID != "" {
			var contents bytes.Buffer
			if err := w.restic(ctx, c, &contents, "dump", r.Snapshot, "/manifest.json"); err != nil {
				return fmt.Errorf("cannot read snapshot manifest: %w", err)
			}
			var manifest struct {
				Items []Item `json:"items"`
			}
			if err := jsonDecode(contents.Bytes(), &manifest); err != nil {
				return fmt.Errorf("invalid snapshot manifest: %w", err)
			}
			found := false
			for _, item := range manifest.Items {
				if item.AppID == r.AppID {
					found = true
				}
			}
			if !found {
				return fmt.Errorf("this snapshot contains no backup items for %s", r.AppID)
			}
		}
		root := filepath.Join(w.Home, "restores")
		if err := os.MkdirAll(root, 0700); err != nil {
			return err
		}
		target, err := os.MkdirTemp(root, "recovery-")
		if err != nil {
			return err
		}
		args := []string{"restore", r.Snapshot, "--target", target, "--verify"}
		if r.AppID != "" {
			args = append(args, "--include", "/apps/"+r.AppID, "--include", "/manifest.json")
		}
		if err := w.restic(ctx, c, io.Discard, args...); err != nil {
			return fmt.Errorf("restore failed; incomplete files remain in %s: %w", target, err)
		}
		s.RestorePath = target
		s.Message = "Recovery copy verified at " + target + ". Live app data has not been overwritten."
	}
	var snapshots bytes.Buffer
	if err := w.restic(ctx, c, &snapshots, "snapshots", "--tag", "kimono", "--json"); err != nil {
		return fmt.Errorf("operation completed, but snapshot listing failed: %w", err)
	}
	if err := jsonDecode(snapshots.Bytes(), &s.Snapshots); err != nil {
		return err
	}
	sort.Slice(s.Snapshots, func(i, j int) bool { return s.Snapshots[i].Time > s.Snapshots[j].Time })
	if len(s.Snapshots) > 50 {
		s.Snapshots = s.Snapshots[:50]
	}
	return nil
}

func (w *Worker) restic(ctx context.Context, c Config, out io.Writer, args ...string) error {
	env := []string{"RESTIC_REPOSITORY=" + c.Repository(), "RESTIC_PASSWORD=" + c.Password, "AWS_ACCESS_KEY_ID=" + c.KeyID, "AWS_SECRET_ACCESS_KEY=" + c.ApplicationKey, "RESTIC_CACHE_DIR=" + filepath.Join(w.Home, "backup-work", "cache")}
	if err := w.Command(ctx, "restic", append([]string{"--retry-lock", "2m"}, args...), env, filepath.Join(w.Home, "backup-work"), out); err != nil {
		return err
	}
	return nil
}
func (w *Worker) repository(ctx context.Context, c Config, initialize bool) error {
	if err := os.MkdirAll(filepath.Join(w.Home, "backup-work"), 0700); err != nil {
		return err
	}
	err := w.restic(ctx, c, io.Discard, "cat", "config")
	if err == nil {
		return nil
	}
	var exit *exec.ExitError
	if initialize && errors.As(err, &exit) && exit.ExitCode() == 10 {
		if err := w.restic(ctx, c, io.Discard, "init", "--repository-version", "2"); err != nil {
			return fmt.Errorf("could not initialize encrypted repository: %w", err)
		}
		return nil
	}
	return fmt.Errorf("cannot open backup repository; check B2 credentials, endpoint, and recovery password: %w", err)
}

func (w *Worker) backup(ctx context.Context, c Config) error {
	var plan Plan
	if err := readJSON(filepath.Join(w.State, "deployment", "plan.json"), &plan); err != nil {
		return fmt.Errorf("cannot read application backup declarations: %w", err)
	}
	var items []Item
	seen := map[string]bool{}
	for _, item := range plan.Items {
		if err := item.Validate(); err != nil {
			return err
		}
		if seen[item.ID] {
			return fmt.Errorf("duplicate backup item %s", item.ID)
		}
		seen[item.ID] = true
		if c.Selected(item) {
			items = append(items, item)
		}
	}
	for id, selected := range c.Items {
		appID, _, _ := strings.Cut(id, "/")
		if selected && c.Apps[appID] && !seen[id] {
			return fmt.Errorf("selected backup item %s is no longer declared; review backup settings", id)
		}
	}
	if len(items) == 0 && !c.Platform {
		return fmt.Errorf("no backup items are selected")
	}
	// Database exports precede files (including Immich's library).
	sort.SliceStable(items, func(i, j int) bool { return databaseMethod(items[i].Method) && !databaseMethod(items[j].Method) })
	stage := filepath.Join(w.Home, "backup-work", "stage")
	if err := os.RemoveAll(stage); err != nil {
		return err
	}
	if err := os.MkdirAll(stage, 0700); err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	var captured []Item
	for _, item := range items {
		// A selected item must exist even when its app is disabled. Never turn a
		// missing volume into a successful empty backup.
		if !item.Active && item.Volume != "" {
			if err := w.Command(ctx, "docker", []string{"volume", "inspect", item.Volume}, nil, "", io.Discard); err != nil {
				return fmt.Errorf("%s: selected data volume is unavailable; deselect this item if the app has never been started", item.ID)
			}
		}
		target := filepath.Join(stage, "apps", item.AppID)
		if err := os.MkdirAll(target, 0700); err != nil {
			return err
		}
		parts := strings.Split(item.ID, "/")
		filename := parts[1] + map[string]string{"files": ".tar", "sqlite": ".sqlite", "postgres": ".dump", "settings": ".json"}[item.Method]
		if err := w.capture(ctx, item, filepath.Join(target, filename)); err != nil {
			return fmt.Errorf("%s: export failed (%s); check the app is running and source paths exist: %w", item.ID, item.Method, err)
		}
		captured = append(captured, item)
	}
	if c.Platform {
		if err := w.platform(ctx, c, stage); err != nil {
			return fmt.Errorf("platform backup failed: %w", err)
		}
	}
	manifest := map[string]any{"version": 1, "createdAt": w.Now().UTC().Format(time.RFC3339), "consistency": "online: database exports precede live file copies; cross-item point-in-time consistency is not guaranteed", "items": captured, "platform": c.Platform, "compose": plan.Compose}
	if err := writeJSON(filepath.Join(stage, "manifest.json"), manifest, 0600); err != nil {
		return err
	}
	// Stable relative paths and host keep incremental backups and retention
	// independent of container IDs and changing item selections.
	env := []string{"RESTIC_REPOSITORY=" + c.Repository(), "RESTIC_PASSWORD=" + c.Password, "AWS_ACCESS_KEY_ID=" + c.KeyID, "AWS_SECRET_ACCESS_KEY=" + c.ApplicationKey, "RESTIC_CACHE_DIR=" + filepath.Join(w.Home, "backup-work", "cache")}
	var output bytes.Buffer
	if err := w.Command(ctx, "restic", []string{"--retry-lock", "2m", "backup", "--host", "kimono", "--tag", "kimono-pending", ".", "--json"}, env, stage, &output); err != nil {
		return fmt.Errorf("encrypted upload failed or was incomplete: %w", err)
	}
	id, err := completedSnapshot(output.Bytes())
	if err != nil {
		return err
	}
	// restic can leave a snapshot after an incomplete backup. Only promote a
	// zero-exit upload into the set displayed and managed by retention.
	if err := w.restic(ctx, c, io.Discard, "tag", "--add", "kimono", "--remove", "kimono-pending", id); err != nil {
		return fmt.Errorf("upload saved, but marking the snapshot complete failed: %w", err)
	}
	return nil
}
func databaseMethod(method string) bool { return method == "postgres" || method == "sqlite" }

func (w *Worker) output(ctx context.Context, target, name string, args ...string) error {
	f, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	err = w.Command(ctx, name, args, nil, "", f)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func (w *Worker) container(ctx context.Context, project, service string) (string, error) {
	var out bytes.Buffer
	if err := w.Command(ctx, "docker", []string{"ps", "--filter", "label=com.docker.compose.project=" + project, "--filter", "label=com.docker.compose.service=" + service, "--format", "{{.ID}}"}, nil, "", &out); err != nil {
		return "", err
	}
	ids := strings.Fields(out.String())
	if len(ids) != 1 {
		return "", fmt.Errorf("expected one running %s container", service)
	}
	return ids[0], nil
}
func (w *Worker) helper(volume string) []string {
	return []string{"run", "--rm", "--network", "none", "--security-opt", "no-new-privileges:true", "--mount", "type=volume,src=" + volume + ",dst=/source,readonly", "--entrypoint", "/bin/sh", w.HelperImage}
}
func (w *Worker) capture(ctx context.Context, item Item, target string) error {
	switch item.Method {
	case "postgres":
		container, err := w.container(ctx, "kimono-apps", item.Service)
		if err != nil {
			return err
		}
		return w.output(ctx, target, "docker", "exec", container, "pg_dump", "--no-password", "--format=custom", "--username", item.Username, "--dbname", item.Database)
	case "settings":
		return copyFile(filepath.Join(w.Home, "apps", "apps", item.AppID+"-settings.json"), target)
	case "files", "sqlite":
		// Docker would silently create an empty named volume on run. Inspect first.
		if err := w.Command(ctx, "docker", []string{"volume", "inspect", item.Volume}, nil, "", io.Discard); err != nil {
			return fmt.Errorf("source volume does not exist")
		}
		args := w.helper(item.Volume)
		if item.Method == "sqlite" {
			// Shell text is fixed. Source paths are positional arguments, never code.
			args = append(args, "-ec", `test -f "/source/$1"; sqlite3 -readonly "/source/$1" '.timeout 30000' '.backup /tmp/backup.sqlite'; test "$(sqlite3 /tmp/backup.sqlite 'PRAGMA quick_check;')" = ok; cat /tmp/backup.sqlite`, "backup", item.Paths[0])
		} else {
			args = append(args, "-ec", `exec tar -C /source -cf - "$@"`, "backup")
			for _, exclude := range item.Exclude {
				args = append(args, "--exclude=./"+exclude, "--exclude="+exclude)
			}
			args = append(args, "--")
			args = append(args, item.Paths...)
		}
		return w.output(ctx, target, "docker", args...)
	}
	return fmt.Errorf("unsupported method")
}
func copyFile(source, target string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}

// ServerVolumes are the appliance's own named volumes that hold state rather
// than cache: Watch's nzbdav and AIOStreams configuration, and Caddy's
// certificates (kept so a restored server does not wait on, or exhaust, ACME).
// One that an older appliance never created is skipped, not an error.
var ServerVolumes = []string{"caddy_data", "nzbdav_config", "aiostreams_data"}

// Settings are the backup choices without the repository credentials, saved in
// every snapshot so a restored server keeps its schedule and selections; the
// recovery kit supplies the credentials.
type Settings struct {
	Enabled  bool            `json:"enabled"`
	HourUTC  int             `json:"hourUTC"`
	Daily    int             `json:"daily"`
	Weekly   int             `json:"weekly"`
	Monthly  int             `json:"monthly"`
	Platform bool            `json:"platform"`
	Apps     map[string]bool `json:"apps"`
	Items    map[string]bool `json:"items"`
}

func (w *Worker) platform(ctx context.Context, c Config, stage string) error {
	target := filepath.Join(stage, "platform")
	if err := os.MkdirAll(target, 0700); err != nil {
		return err
	}
	settings := Settings{Enabled: c.Enabled, HourUTC: c.HourUTC, Daily: c.Daily, Weekly: c.Weekly, Monthly: c.Monthly, Platform: c.Platform, Apps: c.Apps, Items: c.Items}
	if err := writeJSON(filepath.Join(target, "backup-settings.json"), settings, 0600); err != nil {
		return err
	}
	for _, volume := range ServerVolumes {
		name := "kimono-server_" + volume
		if err := w.Command(ctx, "docker", []string{"volume", "inspect", name}, nil, "", io.Discard); err != nil {
			continue
		}
		item := Item{ID: volume, Method: "files", Volume: name, Paths: []string{"."}}
		if err := w.capture(ctx, item, filepath.Join(target, strings.ReplaceAll(volume, "_", "-")+".tar")); err != nil {
			return fmt.Errorf("%s: %w", volume, err)
		}
	}
	container, err := w.container(ctx, "kimono-server", "postgresql")
	if err != nil {
		return err
	}
	if err := w.output(ctx, filepath.Join(target, "authentik.dump"), "docker", "exec", container, "sh", "-ec", `exec pg_dump --no-password --format=custom --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"`); err != nil {
		return err
	}
	for _, item := range []Item{
		{ID: "headscale", Method: "sqlite", Volume: "kimono-server_headscale_data", Paths: []string{"db.sqlite"}},
		{ID: "headscale-files", Method: "files", Volume: "kimono-server_headscale_data", Paths: []string{"."}, Exclude: []string{"db.sqlite", "db.sqlite-wal", "db.sqlite-shm", "db.sqlite-journal"}},
		{ID: "authentik-data", Method: "files", Volume: "kimono-server_authentik_data", Paths: []string{"."}},
	} {
		extension := ".tar"
		if item.Method == "sqlite" {
			extension = ".sqlite"
		}
		if err := w.capture(ctx, item, filepath.Join(target, item.ID+extension)); err != nil {
			return err
		}
	}
	for _, source := range []struct {
		name, path string
		excludes   []string
	}{
		{"server", w.Home, []string{"./backup-work", "./backups", "./restores"}},
		{"portal", w.State, []string{"./backups"}},
		{"definitions", "/etc/kimono/app-definitions", nil},
	} {
		if _, err := os.Stat(source.path); err != nil {
			return err
		}
		args := []string{"-C", source.path, "-cf", filepath.Join(target, source.name+".tar")}
		for _, exclude := range source.excludes {
			args = append(args, "--exclude="+exclude)
		}
		args = append(args, ".")
		if err := w.Command(ctx, "tar", args, nil, "", io.Discard); err != nil {
			return err
		}
	}
	return nil
}
