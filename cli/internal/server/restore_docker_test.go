package server

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

// TestRestorePrimitivesWithDocker exercises the restore's volume and database
// steps against a real Docker engine. Set KIMONO_TEST_DOCKER_IMAGE to an image
// with the reconciler's tools (docker:28-cli plus restic, sqlite and tar).
func TestRestorePrimitivesWithDocker(t *testing.T) {
	image := os.Getenv("KIMONO_TEST_DOCKER_IMAGE")
	if image == "" {
		t.Skip("set KIMONO_TEST_DOCKER_IMAGE to run against Docker")
	}
	run := func(args ...string) string {
		t.Helper()
		out, err := exec.Command("docker", args...).CombinedOutput()
		if err != nil {
			t.Fatalf("docker %s: %v\n%s", strings.Join(args, " "), err, out)
		}
		return strings.TrimSpace(string(out))
	}
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "apps", "demo"), 0755); err != nil {
		t.Fatal(err)
	}
	source, volume, pg := "kimono-restore-test-source", "kimono-apps_demo-data", "kimono-restore-test-pg"
	cleanup := func() {
		_ = exec.Command("docker", "rm", "-f", pg).Run()
		_ = exec.Command("docker", "volume", "rm", "-f", source, volume).Run()
	}
	cleanup()
	t.Cleanup(cleanup)

	// What a backup would have captured: owned files and a WAL-mode database.
	run("volume", "create", source)
	run("run", "--rm", "-v", source+":/source", "-v", dir+":/out", "--entrypoint", "/bin/sh", image, "-ec", `
		mkdir -p /source/files/nested; echo hello > /source/files/nested/a.txt; chown -R 1000:1000 /source/files
		mkdir -p /source/nested; chown 1000:1000 /source/nested
		sqlite3 /source/nested/db.sqlite 'PRAGMA journal_mode=WAL; CREATE TABLE t(v); INSERT INTO t VALUES (42);'
		tar -C /source -cf /out/apps/demo/files.tar files
		sqlite3 -readonly /source/nested/db.sqlite '.backup /out/apps/demo/db.sqlite'`)

	var stdout bytes.Buffer
	r := &applianceRestore{m: &Manager{Runner: &system.Runner{Stdout: &stdout, Stderr: &stdout}, Home: dir}, image: image, dir: dir}
	if err := r.freshVolume(volume, "kimono-apps"); err != nil {
		t.Fatal(err)
	}
	if err := r.freshVolume(volume, "kimono-apps"); err == nil {
		t.Fatal("replaced an existing volume without --force")
	}
	if got := run("volume", "inspect", "--format", `{{index .Labels "com.docker.compose.project"}}/{{index .Labels "com.docker.compose.volume"}}`, volume); got != "kimono-apps/demo-data" {
		t.Fatalf("volume labels %q", got)
	}
	if err := r.fill(volume, "/restore/apps/demo/files.tar"); err != nil {
		t.Fatal(err)
	}
	run("run", "--rm", "-v", volume+":/target", "--entrypoint", "/bin/sh", image, "-ec", `mkdir -p /target/nested; chown 1000:1000 /target/nested; touch /target/nested/db.sqlite-wal`)
	if err := r.placeSQLite(volume, "/restore/apps/demo/db.sqlite", "nested/db.sqlite"); err != nil {
		t.Fatal(err)
	}
	got := run("run", "--rm", "-v", volume+":/target", "--entrypoint", "/bin/sh", image, "-ec",
		`stat -c %u /target/files/nested/a.txt; cat /target/files/nested/a.txt; stat -c %u /target/nested/db.sqlite; sqlite3 /target/nested/db.sqlite 'SELECT v FROM t'; test ! -e /target/nested/db.sqlite-wal && echo nowal`)
	if got != "1000\nhello\n1000\n42\nnowal" {
		t.Fatalf("restored volume:\n%s", got)
	}

	// A database restored from its dump into a fresh server.
	run("run", "-d", "--name", pg, "--label", "com.docker.compose.project=kimono-test", "--label", "com.docker.compose.service=db",
		"-e", "POSTGRES_USER=app", "-e", "POSTGRES_DB=app", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:16-alpine")
	for i := 0; ; i++ {
		if exec.Command("docker", "exec", pg, "psql", "-U", "app", "-d", "app", "-c", "SELECT 1").Run() == nil {
			break
		}
		if i > 60 {
			t.Fatal("postgres did not start")
		}
		run("exec", pg, "sleep", "1")
	}
	run("exec", pg, "psql", "-U", "app", "-d", "app", "-c", "CREATE TABLE people(name text); INSERT INTO people VALUES ('akram');")
	dump := filepath.Join(dir, "app.dump")
	out, err := exec.Command("docker", "exec", pg, "pg_dump", "--format=custom", "-U", "app", "-d", "app").Output()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dump, out, 0600); err != nil {
		t.Fatal(err)
	}
	run("exec", pg, "psql", "-U", "app", "-d", "app", "-c", "DROP TABLE people;")
	if err := r.pgRestore("kimono-test", "db", dump, "", ""); err != nil {
		t.Fatalf("%v\n%s", err, stdout.String())
	}
	if got := run("exec", pg, "psql", "-U", "app", "-d", "app", "-Atc", "SELECT name FROM people"); got != "akram" {
		t.Fatalf("restored rows %q", got)
	}
	if err := r.pgRestore("kimono-test", "db", dump, "app", "app"); err != nil {
		t.Fatalf("explicit user/database: %v\n%s", err, stdout.String())
	}
}
