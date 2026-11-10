package backup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func validConfig() Config {
	return Config{Version: 1, Enabled: true, Endpoint: "https://s3.us-west-004.backblazeb2.com", Bucket: "kimono-test", Prefix: "kimono", KeyID: "key-id", ApplicationKey: "secret-key", Password: strings.Repeat("a", 64), RecoverySaved: true, HourUTC: 3, Daily: 7, Weekly: 4, Monthly: 6, Apps: map[string]bool{}, Items: map[string]bool{}}
}
func fixture(t *testing.T) (*Worker, Config) {
	t.Helper()
	root := t.TempDir()
	w := New(filepath.Join(root, "home"), filepath.Join(root, "portal"))
	w.Now = func() time.Time { return time.Date(2026, 9, 26, 4, 0, 0, 0, time.UTC) }
	for _, dir := range []string{w.dir(), filepath.Join(w.State, "deployment"), filepath.Join(w.Home, "apps", "apps")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	c := validConfig()
	if err := writeJSON(filepath.Join(w.dir(), "config.json"), c, 0600); err != nil {
		t.Fatal(err)
	}
	return w, c
}
func TestSelections(t *testing.T) {
	c := validConfig()
	i := Item{ID: "immich/photos", AppID: "immich", Default: true, Active: true}
	if !c.Selected(i) {
		t.Fatal("expected default selection")
	}
	c.Items[i.ID] = false
	if c.Selected(i) {
		t.Fatal("item off ignored")
	}
	c.Items[i.ID] = true
	c.Apps[i.AppID] = false
	if c.Selected(i) {
		t.Fatal("app off ignored")
	}
	c.Apps[i.AppID] = true
	if !c.Selected(i) {
		t.Fatal("item selection lost when app enabled")
	}
}
func TestSchedule(t *testing.T) {
	c := validConfig()
	now := time.Date(2026, 9, 26, 4, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		s    Status
		now  time.Time
		want bool
	}{
		{"initial", Status{}, now, true},
		{"before hour", Status{}, now.Add(-2 * time.Hour), false},
		{"success today", Status{LastSuccess: now.Add(-time.Minute).Format(time.RFC3339)}, now, false},
		{"retry backoff", Status{LastAttempt: now.Add(-30 * time.Minute).Format(time.RFC3339)}, now, false},
		{"retry due", Status{LastAttempt: now.Add(-time.Hour).Format(time.RFC3339)}, now, true},
		{"yesterday", Status{LastSuccess: now.Add(-24 * time.Hour).Format(time.RFC3339)}, now, true},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			if got := Due(c, tt.s, tt.now); got != tt.want {
				t.Fatalf("got %v", got)
			}
		})
	}
	c.Enabled = false
	if Due(c, Status{}, now) {
		t.Fatal("paused schedule ran")
	}
}
func TestValidation(t *testing.T) {
	good := Item{ID: "immich/photos", AppID: "immich", Method: "files", Volume: "kimono-apps_immich-library", Paths: []string{"."}}
	if err := good.Validate(); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"../secret", "/etc/shadow", "x/../../secret", "--checkpoint-action=exec=x", "x/../y", "x;touch"} {
		bad := good
		bad.Paths = []string{p}
		if bad.Validate() == nil {
			t.Fatalf("accepted %q", p)
		}
	}
	bad := good
	bad.Volume = "kimono-server_authentik_data"
	if bad.Validate() == nil {
		t.Fatal("accepted another app's volume")
	}
	c := validConfig()
	c.Endpoint = "https://attacker.example"
	if c.Validate() == nil {
		t.Fatal("accepted untrusted credential destination")
	}
}
func TestExportFailureNeverUploadsOrPrunes(t *testing.T) {
	w, c := fixture(t)
	item := Item{ID: "immich/database", AppID: "immich", Method: "postgres", Service: "immich-database", Database: "immich", Username: "immich", Default: true, Active: true}
	if err := writeJSON(filepath.Join(w.State, "deployment", "plan.json"), Plan{Items: []Item{item}}, 0600); err != nil {
		t.Fatal(err)
	}
	var calls []string
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		call := name + " " + strings.Join(args, " ")
		calls = append(calls, call)
		if name == "docker" && args[0] == "ps" {
			io.WriteString(out, "container123\n")
		}
		if name == "docker" && args[0] == "exec" {
			return errors.New("database export failed")
		}
		return nil
	}
	var s Status
	if err := w.perform(context.Background(), c, Request{Action: "backup"}, &s); err == nil {
		t.Fatal("failure ignored")
	}
	if s.State != "failed" || s.LastSuccess != "" {
		t.Fatal("reported success")
	}
	for _, call := range calls {
		if strings.Contains(call, "forget") || strings.Contains(call, "backup --host") {
			t.Fatalf("unsafe command after failure: %s", call)
		}
	}
	if _, err := os.Stat(filepath.Join(w.Home, "backup-work", "stage")); !os.IsNotExist(err) {
		t.Fatal("plaintext staging left behind")
	}
}
func TestDatabaseFirstAndCredentialsOnlyInEnvironment(t *testing.T) {
	w, c := fixture(t)
	items := []Item{
		{ID: "immich/photos", AppID: "immich", Method: "files", Volume: "kimono-apps_immich-library", Paths: []string{"."}, Default: true, Active: true},
		{ID: "immich/database", AppID: "immich", Method: "postgres", Service: "immich-database", Database: "immich", Username: "immich", Default: true, Active: true},
	}
	if err := writeJSON(filepath.Join(w.State, "deployment", "plan.json"), Plan{Items: items}, 0600); err != nil {
		t.Fatal(err)
	}
	var exports []string
	uploaded := false
	pruned := false
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		call := strings.Join(args, " ")
		for _, secret := range []string{c.Password, c.ApplicationKey} {
			if strings.Contains(call, secret) {
				t.Fatal("secret exposed in argv")
			}
		}
		if name == "docker" {
			switch args[0] {
			case "ps":
				io.WriteString(out, "container123\n")
			case "exec":
				exports = append(exports, "database")
				io.WriteString(out, "dump")
			case "run":
				exports = append(exports, "files")
				io.WriteString(out, "files")
			}
			if args[0] == "stop" || args[0] == "pause" {
				t.Fatal("stopped app")
			}
		}
		if name == "restic" {
			if len(env) != 5 {
				t.Fatal("missing scoped restic environment")
			}
			if strings.Contains(call, "backup --host") {
				uploaded = true
				io.WriteString(out, `{"message_type":"summary","snapshot_id":"`+strings.Repeat("c", 64)+`"}`)
				if _, err := os.Stat(filepath.Join(dir, "apps", "immich", "database.dump")); err != nil {
					t.Fatal(err)
				}
				if _, err := os.Stat(filepath.Join(dir, "manifest.json")); err != nil {
					t.Fatal(err)
				}
			}
			if strings.Contains(call, "forget") {
				if !uploaded {
					t.Fatal("pruned before backup")
				}
				pruned = true
			}
			if strings.Contains(call, "snapshots") {
				io.WriteString(out, "[]")
			}
		}
		return nil
	}
	var s Status
	if err := w.perform(context.Background(), c, Request{Action: "backup"}, &s); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(exports, []string{"database", "files"}) || !uploaded || !pruned || s.LastSuccess == "" {
		t.Fatalf("incomplete sequence: %v %+v", exports, s)
	}
}
func TestPartialUploadNeverPrunes(t *testing.T) {
	w, c := fixture(t)
	if err := os.WriteFile(filepath.Join(w.Home, "apps", "apps", "immich-settings.json"), []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(w.State, "deployment", "plan.json"), Plan{Items: []Item{{ID: "immich/config", AppID: "immich", Method: "settings", Default: true, Active: true}}}, 0600); err != nil {
		t.Fatal(err)
	}
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		if name == "restic" && strings.Contains(strings.Join(args, " "), "backup --host") {
			return errors.New("partial upload")
		}
		if strings.Contains(strings.Join(args, " "), "forget") {
			t.Fatal("retention ran after partial upload")
		}
		return nil
	}
	var s Status
	if w.perform(context.Background(), c, Request{Action: "backup"}, &s) == nil {
		t.Fatal("partial backup accepted")
	}
}
func TestRestoreIsIsolatedAndVerified(t *testing.T) {
	w, c := fixture(t)
	snapshot := strings.Repeat("b", 64)
	restored := false
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "dump ") {
			io.WriteString(out, `{"items":[{"appId":"immich"}]}`)
		}
		if strings.Contains(joined, "restore ") {
			restored = true
			if !strings.Contains(joined, "--verify") || !strings.Contains(joined, "--include /apps/immich") {
				t.Fatal(joined)
			}
			if !strings.Contains(joined, filepath.Join(w.Home, "restores", "recovery-")) {
				t.Fatal("restore outside recovery directory")
			}
		}
		if strings.Contains(joined, "snapshots") {
			io.WriteString(out, "[]")
		}
		return nil
	}
	var s Status
	if err := w.perform(context.Background(), c, Request{Action: "restore", Snapshot: snapshot, AppID: "immich"}, &s); err != nil {
		t.Fatal(err)
	}
	if !restored || s.RestorePath == "" {
		t.Fatal("restore missing")
	}
	if err := w.perform(context.Background(), c, Request{Action: "restore", Snapshot: "latest;rm", AppID: "../"}, &s); err == nil {
		t.Fatal("invalid restore accepted")
	}
}
func TestTickConsumesManualRequestWithSchedulePaused(t *testing.T) {
	w, c := fixture(t)
	c.Enabled = false
	if err := writeJSON(filepath.Join(w.dir(), "config.json"), c, 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSON(filepath.Join(w.dir(), "request.json"), Request{Action: "check"}, 0600); err != nil {
		t.Fatal(err)
	}
	var called bool
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		if strings.Contains(strings.Join(args, " "), "check") {
			called = true
		}
		if strings.Contains(strings.Join(args, " "), "snapshots") {
			io.WriteString(out, "[]")
		}
		return nil
	}
	if err := w.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !called {
		t.Fatal("manual request ignored while schedule paused")
	}
	if _, err := os.Stat(filepath.Join(w.dir(), "request.json")); !os.IsNotExist(err) {
		t.Fatal("request was not consumed")
	}
	var s Status
	if err := readJSON(w.statusPath(), &s); err != nil {
		t.Fatal(err)
	}
	if s.State != "ready" {
		t.Fatalf("%+v", s)
	}
}
func TestStatusContainsNoCredentials(t *testing.T) {
	w, c := fixture(t)
	w.Command = func(_ context.Context, name string, args, env []string, dir string, out io.Writer) error {
		if strings.Contains(strings.Join(args, " "), "snapshots") {
			io.WriteString(out, "[]")
		}
		return nil
	}
	var s Status
	if err := w.perform(context.Background(), c, Request{Action: "check"}, &s); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(w.statusPath())
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{c.Password, c.ApplicationKey} {
		if bytes.Contains(data, []byte(secret)) {
			t.Fatal("credentials in status")
		}
	}
	var parsed map[string]any
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatal(err)
	}
}

func TestImportKitPreservesPasswordAndPausesSchedule(t *testing.T) {
	w, c := fixture(t)
	file := filepath.Join(t.TempDir(), "kit.json")
	kit := RecoveryKit{Format: "kimono-recovery-v1", Repository: c.Repository(), Password: c.Password, KeyID: c.KeyID, ApplicationKey: c.ApplicationKey}
	if err := writeJSON(file, kit, 0600); err != nil {
		t.Fatal(err)
	}
	if err := w.ImportKit(file); err != nil {
		t.Fatal(err)
	}
	restored, err := w.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if restored.Enabled || restored.Password != c.Password || restored.Repository() != c.Repository() {
		t.Fatalf("recovery configuration differs")
	}
	info, err := os.Stat(filepath.Join(w.dir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatal("credentials are not private")
	}
	kit.Repository = "s3:https://attacker.example/bucket/path"
	if err := writeJSON(file, kit, 0600); err != nil {
		t.Fatal(err)
	}
	if w.ImportKit(file) == nil {
		t.Fatal("accepted a credential destination outside B2")
	}
}

func TestMissingSelectionFailsBeforeExport(t *testing.T) {
	w, c := fixture(t)
	c.Apps["immich"] = true
	c.Items["immich/photos"] = true
	if err := writeJSON(filepath.Join(w.State, "deployment", "plan.json"), Plan{}, 0600); err != nil {
		t.Fatal(err)
	}
	w.Command = func(context.Context, string, []string, []string, string, io.Writer) error {
		t.Fatal("export should not run")
		return nil
	}
	if err := w.backup(context.Background(), c); err == nil || !strings.Contains(err.Error(), "no longer declared") {
		t.Fatalf("missing item was not reported: %v", err)
	}
}

func TestPlatformSavesSettingsWithoutCredentialsAndServerVolumes(t *testing.T) {
	w, c := fixture(t)
	c.Platform = true
	c.Apps["immich"] = true
	defs := filepath.Join(t.TempDir(), "definitions")
	if err := os.MkdirAll(defs, 0700); err != nil {
		t.Fatal(err)
	}
	stage := t.TempDir()
	var captured []string
	w.Command = func(_ context.Context, name string, args, _ []string, _ string, out io.Writer) error {
		if name == "docker" && args[0] == "volume" && args[1] == "inspect" && args[2] == "kimono-server_aiostreams_data" {
			return errors.New("no such volume")
		}
		if name == "docker" && args[0] == "ps" {
			io.WriteString(out, "container123\n")
		}
		if name == "docker" && args[0] == "run" {
			for _, arg := range args {
				if strings.HasPrefix(arg, "type=volume,src=") {
					captured = append(captured, strings.TrimPrefix(strings.Split(arg, ",")[1], "src="))
				}
			}
		}
		return nil
	}
	// The definitions directory is fixed at /etc/kimono/app-definitions; skip
	// the tar step where it is absent and check what precedes it.
	_ = w.platform(context.Background(), c, stage)
	data, err := os.ReadFile(filepath.Join(stage, "platform", "backup-settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{c.Password, c.ApplicationKey, c.KeyID} {
		if strings.Contains(string(data), secret) {
			t.Fatal("settings carry credentials")
		}
	}
	var saved Settings
	if err := json.Unmarshal(data, &saved); err != nil || !saved.Enabled || !saved.Apps["immich"] {
		t.Fatalf("settings not saved: %s", data)
	}
	want := []string{"kimono-server_caddy_data", "kimono-server_nzbdav_config", "kimono-server_headscale_data", "kimono-server_headscale_data", "kimono-server_authentik_data"}
	if !reflect.DeepEqual(captured, want) {
		t.Fatalf("captured %v", captured)
	}
}

func TestImportKitWithSettingsResumesSchedule(t *testing.T) {
	w, c := fixture(t)
	dir := t.TempDir()
	kit := filepath.Join(dir, "kit.json")
	if err := writeJSON(kit, RecoveryKit{Format: "kimono-recovery-v1", Repository: c.Repository(), Password: c.Password, KeyID: c.KeyID, ApplicationKey: c.ApplicationKey}, 0600); err != nil {
		t.Fatal(err)
	}
	settings := filepath.Join(dir, "settings.json")
	if err := writeJSON(settings, Settings{Enabled: true, HourUTC: 5, Daily: 9, Weekly: 4, Monthly: 6, Platform: true, Apps: map[string]bool{"immich": true}, Items: map[string]bool{"immich/previews": true}}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := w.ImportKitWithSettings(kit, settings); err != nil {
		t.Fatal(err)
	}
	restored, err := w.loadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !restored.Enabled || restored.HourUTC != 5 || restored.Daily != 9 || !restored.Items["immich/previews"] || restored.Password != c.Password {
		t.Fatalf("settings not resumed: %+v", restored)
	}
}
