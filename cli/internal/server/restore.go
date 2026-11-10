package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/backup"
	"github.com/kimonoapps/kimono/cli/internal/reconcile"
	"github.com/kimonoapps/kimono/cli/internal/sandbox"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

var fullSnapshotID = regexp.MustCompile(`^[a-f0-9]{64}$`)

// restoreAppliance rebuilds a whole Kimono server from an encrypted backup on
// a fresh machine: settings and secrets, identity, mesh, Watch's services,
// every backed-up app's volumes and databases, then starts it all. Only Docker
// is needed on the host; restic runs inside the reconciler image.
func (m *Manager) restoreAppliance(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("server restore", flag.ContinueOnError)
	snapshot := flags.String("snapshot", "latest", "full snapshot ID, or latest")
	force := flags.Bool("force", false, "replace an existing Kimono server on this machine, including its data volumes")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("usage: kimono server restore [--snapshot ID] [--force] /path/to/kimono-recovery-kit.json")
	}
	kitFile, err := filepath.Abs(flags.Arg(0))
	if err != nil {
		return err
	}
	config, err := backup.KitConfig(kitFile)
	if err != nil {
		return fmt.Errorf("read recovery kit: %w", err)
	}
	if *snapshot != "latest" && !fullSnapshotID.MatchString(*snapshot) {
		return errors.New("--snapshot must be a full 64-character snapshot ID, or latest")
	}
	if _, err := os.Stat(m.envPath()); err == nil && !*force {
		return errors.New("a Kimono server is already installed here; pass --force to replace it and its data with the backup")
	}
	if m.Runner.DryRun {
		_, err := fmt.Fprintf(m.Runner.Stdout, "Would restore the whole Kimono server from snapshot %s.\n", *snapshot)
		return err
	}
	if err := m.ensureDocker(); err != nil {
		return err
	}
	r := &applianceRestore{m: m, config: config, image: "ghcr.io/kimonoapps/kimono-reconciler:" + releaseImageTag(sandbox.Version), force: *force}
	return r.run(*snapshot, kitFile)
}

type applianceRestore struct {
	m      *Manager
	config backup.Config
	image  string
	force  bool
	dir    string // the downloaded snapshot
}

func (r *applianceRestore) say(format string, args ...any) {
	_, _ = fmt.Fprintf(r.m.Runner.Stdout, format+"\n", args...)
}

func (r *applianceRestore) run(snapshot, kitFile string) error {
	m := r.m
	if err := os.MkdirAll(filepath.Join(m.Home, "restores"), 0700); err != nil {
		return err
	}
	if snapshot == "latest" {
		latest, when, err := r.latestSnapshot()
		if err != nil {
			return err
		}
		snapshot = latest
		r.say("Restoring the latest backup, from %s.", when)
	}
	dir, err := os.MkdirTemp(filepath.Join(m.Home, "restores"), "appliance-")
	if err != nil {
		return err
	}
	r.dir = dir
	r.say("Downloading and verifying the backup…")
	if err := r.restic(nil, []string{"-v", dir + ":/restore"}, "restore", snapshot, "--target", "/restore", "--verify"); err != nil {
		return fmt.Errorf("download backup: %w", err)
	}
	var manifest struct {
		Items    []backup.Item `json:"items"`
		Platform bool          `json:"platform"`
	}
	if err := readJSONFile(filepath.Join(dir, "manifest.json"), &manifest); err != nil {
		return fmt.Errorf("read backup manifest: %w", err)
	}
	if !manifest.Platform {
		return errors.New("this snapshot has no platform backup (settings, identity and mesh), so it cannot rebuild a server; restore it on a running Kimono from Admin → Backups")
	}

	if r.force {
		r.say("Stopping the existing Kimono server…")
		_ = r.appsCompose("down")
		_ = m.compose("down")
	}

	r.say("Restoring settings, secrets and app files…")
	if err := extractTar(filepath.Join(dir, "platform", "server.tar"), m.Home); err != nil {
		return fmt.Errorf("restore server files: %w", err)
	}
	environment, err := readServerEnvironment(m.envPath())
	if err != nil {
		return fmt.Errorf("the backup holds no server settings: %w", err)
	}
	portalState := firstNonEmpty(environment["KIMONO_PORTAL_STATE_PATH"], defaultPortalState)
	definitions := firstNonEmpty(environment["KIMONO_APP_DEFINITIONS_PATH"], filepath.Join(m.serverDir(), "app-definitions"))
	if !filepath.IsAbs(definitions) {
		definitions = filepath.Join(m.serverDir(), definitions)
	}
	if err := extractTar(filepath.Join(dir, "platform", "portal.tar"), portalState); err != nil {
		return fmt.Errorf("restore Portal data: %w", err)
	}
	if err := extractTar(filepath.Join(dir, "platform", "definitions.tar"), definitions); err != nil {
		return fmt.Errorf("restore app definitions: %w", err)
	}
	// Bring this binary's appliance files in beside the saved ones (generated
	// files are kept), and any settings a newer release needs.
	if err := m.extractAppliance(); err != nil {
		return err
	}
	if err := m.ensureServerEnvironment(); err != nil {
		return err
	}

	r.say("Restoring identity, mesh and Watch services…")
	server := map[string]string{
		"kimono-server_authentik_data": "authentik-data.tar",
		"kimono-server_headscale_data": "headscale-files.tar",
	}
	for _, volume := range backup.ServerVolumes {
		server["kimono-server_"+volume] = strings.ReplaceAll(volume, "_", "-") + ".tar"
	}
	for _, volume := range sortedKeys(server) {
		archive := filepath.Join(dir, "platform", server[volume])
		if _, err := os.Stat(archive); os.IsNotExist(err) {
			continue // older backups predate this volume
		}
		if err := r.freshVolume(volume, "kimono-server"); err != nil {
			return err
		}
		if err := r.fill(volume, "/restore/platform/"+server[volume]); err != nil {
			return fmt.Errorf("%s: %w", volume, err)
		}
	}
	if err := r.placeSQLite("kimono-server_headscale_data", "/restore/platform/headscale.sqlite", "db.sqlite"); err != nil {
		return fmt.Errorf("restore mesh database: %w", err)
	}

	r.say("Restoring the identity database…")
	if err := m.compose("up", "-d", "postgresql"); err != nil {
		return err
	}
	if err := r.pgRestore("kimono-server", "postgresql", filepath.Join(dir, "platform", "authentik.dump"), "", ""); err != nil {
		return fmt.Errorf("restore identity database: %w", err)
	}

	// Everything but the reconciler, so the apps cannot start on empty
	// databases before theirs are back; this also makes the shared networks.
	r.say("Starting Kimono…")
	if err := m.compose("up", "-d", "--remove-orphans", "--scale", "reconciler=0"); err != nil {
		return err
	}

	if err := r.restoreApps(manifest.Items); err != nil {
		return err
	}

	worker := backup.New(m.Home, portalState)
	settings := filepath.Join(dir, "platform", "backup-settings.json")
	if _, err := os.Stat(settings); err != nil {
		settings = ""
	}
	if err := worker.ImportKitWithSettings(kitFile, settings); err != nil {
		return fmt.Errorf("reconnect backups: %w", err)
	}

	if err := m.composeUp(); err != nil {
		return err
	}
	if err := m.bootstrapBlueprints(); err != nil {
		r.say("warning: %s", err)
	}
	if _, err := os.Stat(m.cloudflareConfigPath()); err == nil {
		if err := m.installCloudflareTimer(); err != nil {
			r.say("warning: Cloudflare DNS timer: %s", err)
		} else if err := m.runCloudflareDDNS(); err != nil {
			r.say("warning: Cloudflare DNS update: %s", err)
		} else {
			r.say("Public DNS now points at this machine.")
		}
	} else {
		identity, mesh, portal, _ := m.configuredDomains()
		r.say("Point the DNS records for %s, %s and %s at this machine's public IP.", portal, identity, mesh)
	}
	if err := os.RemoveAll(dir); err != nil {
		r.say("warning: remove downloaded backup %s: %s", dir, err)
	}
	r.say("Kimono is restored. Apps start as the reconciler brings them up; `sudo kimono server status` shows them.")
	return nil
}

// restoreApps puts each backed-up app's data into the volumes and databases
// its compose project will use, before the reconciler starts it.
func (r *applianceRestore) restoreApps(items []backup.Item) error {
	created := map[string]bool{}
	var databases []backup.Item
	for _, item := range items {
		if err := item.Validate(); err != nil {
			return err
		}
		_, name, _ := strings.Cut(item.ID, "/")
		source := "/restore/apps/" + item.AppID + "/" + name
		switch item.Method {
		case "files", "sqlite":
			if !created[item.Volume] {
				if err := r.freshVolume(item.Volume, reconcile.ProjectName); err != nil {
					return err
				}
				created[item.Volume] = true
			}
			var err error
			if item.Method == "files" {
				err = r.fill(item.Volume, source+".tar")
			} else {
				err = r.placeSQLite(item.Volume, source+".sqlite", item.Paths[0])
			}
			if err != nil {
				return fmt.Errorf("%s: %w", item.ID, err)
			}
		case "settings":
			target := filepath.Join(r.m.Home, "apps", "apps", item.AppID+"-settings.json")
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				return err
			}
			if err := system.CopyFile(filepath.Join(r.dir, "apps", item.AppID, name+".json"), target, 0600); err != nil {
				return fmt.Errorf("%s: %w", item.ID, err)
			}
		case "postgres":
			databases = append(databases, item)
		}
		r.say("  %s: %s", item.AppName, item.Label)
	}
	for _, item := range databases {
		if err := r.appsCompose("up", "-d", "--no-deps", item.Service); err != nil {
			return fmt.Errorf("%s: start database: %w", item.ID, err)
		}
		_, name, _ := strings.Cut(item.ID, "/")
		if err := r.pgRestore(reconcile.ProjectName, item.Service, filepath.Join(r.dir, "apps", item.AppID, name+".dump"), item.Username, item.Database); err != nil {
			return fmt.Errorf("%s: %w", item.ID, err)
		}
	}
	return nil
}

func (r *applianceRestore) appsCompose(args ...string) error {
	layout := r.m.reconcilePaths().Layout
	base := []string{"compose", "--project-name", reconcile.ProjectName, "--project-directory", layout.ProjectDir, "--env-file", layout.EnvironmentPath(), "-f", layout.ComposePath()}
	return r.m.Runner.Run("docker", append(base, args...)...)
}

// freshVolume makes an empty named volume labelled as Compose would, so the
// project adopts it. Restoring over existing data needs --force.
func (r *applianceRestore) freshVolume(name, project string) error {
	if err := exec.Command("docker", "volume", "inspect", name).Run(); err == nil {
		if !r.force {
			return fmt.Errorf("volume %s already exists; pass --force to replace it with the backup", name)
		}
		if err := r.m.Runner.Run("docker", "volume", "rm", name); err != nil {
			return err
		}
	}
	key := strings.TrimPrefix(name, project+"_")
	return r.m.Runner.Run("docker", "volume", "create", "--label", "com.docker.compose.project="+project, "--label", "com.docker.compose.volume="+key, name)
}

func (r *applianceRestore) helper(volume string, script string, args ...string) error {
	command := []string{"run", "--rm", "--network", "none", "-v", volume + ":/target", "-v", r.dir + ":/restore:ro", "--entrypoint", "/bin/sh", r.image, "-ec", script, "restore"}
	return r.m.Runner.Run("docker", append(command, args...)...)
}

// fill unpacks an archive into a volume, keeping its owners and modes.
func (r *applianceRestore) fill(volume, archive string) error {
	return r.helper(volume, `tar --numeric-owner -xpf "$1" -C /target`, archive)
}

// placeSQLite puts a standalone database export at its path in the volume,
// owned like its directory, with no stale journal beside it.
func (r *applianceRestore) placeSQLite(volume, source, path string) error {
	return r.helper(volume, `test -f "$1"; mkdir -p "$(dirname "/target/$2")"; rm -f "/target/$2-wal" "/target/$2-shm" "/target/$2-journal"; cp "$1" "/target/$2"; chown "$(stat -c %u:%g "$(dirname "/target/$2")")" "/target/$2"`, source, path)
}

// pgRestore waits for a database container and loads a custom-format dump.
// Empty user and database mean the container's own POSTGRES_USER/POSTGRES_DB.
func (r *applianceRestore) pgRestore(project, service, dump, user, database string) error {
	if _, err := os.Stat(dump); err != nil {
		return err
	}
	var container string
	deadline := time.Now().Add(3 * time.Minute)
	for {
		out, _ := exec.Command("docker", "ps", "--filter", "label=com.docker.compose.project="+project, "--filter", "label=com.docker.compose.service="+service, "--format", "{{.ID}}").Output()
		if ids := strings.Fields(string(out)); len(ids) == 1 {
			container = ids[0]
			if exec.Command("docker", "exec", container, "sh", "-c", `pg_isready -q -U "${1:-$POSTGRES_USER}"`, "ready", user).Run() == nil {
				break
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("database %s did not become ready", service)
		}
		time.Sleep(2 * time.Second)
	}
	if err := r.m.Runner.Run("docker", "cp", dump, container+":/tmp/kimono-restore.dump"); err != nil {
		return err
	}
	return r.m.Runner.Run("docker", "exec", container, "sh", "-ec",
		`pg_restore --clean --if-exists --exit-on-error --no-owner --no-password --username "${1:-$POSTGRES_USER}" --dbname "${2:-$POSTGRES_DB}" /tmp/kimono-restore.dump; rm -f /tmp/kimono-restore.dump`,
		"restore", user, database)
}

// restic runs inside the reconciler image, with credentials passed through the
// environment rather than the command line.
func (r *applianceRestore) restic(out io.Writer, mounts []string, args ...string) error {
	command := []string{"run", "--rm", "-e", "RESTIC_REPOSITORY", "-e", "RESTIC_PASSWORD", "-e", "AWS_ACCESS_KEY_ID", "-e", "AWS_SECRET_ACCESS_KEY"}
	command = append(command, mounts...)
	command = append(command, "--entrypoint", "restic", r.image)
	command = append(command, args...)
	cmd := exec.Command("docker", command...)
	cmd.Env = append(os.Environ(), "RESTIC_REPOSITORY="+r.config.Repository(), "RESTIC_PASSWORD="+r.config.Password, "AWS_ACCESS_KEY_ID="+r.config.KeyID, "AWS_SECRET_ACCESS_KEY="+r.config.ApplicationKey)
	cmd.Stdout = r.m.Runner.Stdout
	if out != nil {
		cmd.Stdout = out
	}
	cmd.Stderr = r.m.Runner.Stderr
	return cmd.Run()
}

func (r *applianceRestore) latestSnapshot() (string, string, error) {
	var out bytes.Buffer
	if err := r.restic(&out, nil, "snapshots", "--tag", "kimono", "--json"); err != nil {
		return "", "", fmt.Errorf("open backup repository; check the recovery kit: %w", err)
	}
	var snapshots []backup.Snapshot
	if err := json.Unmarshal(out.Bytes(), &snapshots); err != nil {
		return "", "", err
	}
	if len(snapshots) == 0 {
		return "", "", errors.New("the backup repository has no completed backups")
	}
	sort.Slice(snapshots, func(i, j int) bool { return snapshots[i].Time > snapshots[j].Time })
	return snapshots[0].ID, snapshots[0].Time, nil
}

func extractTar(archive, target string) error {
	if err := os.MkdirAll(target, 0755); err != nil {
		return err
	}
	cmd := exec.Command("tar", "--numeric-owner", "-xpf", archive, "-C", target)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}

func readJSONFile(file string, value any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func sortedKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
