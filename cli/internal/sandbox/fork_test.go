package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// A second take carries the chat's session on in a new one (--fork-session), so
// the first take's stays as it was; without a session there's nothing to fork.
func TestAgentForksOnlyASession(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(home, "bin")
	if err := os.MkdirAll(filepath.Join(home, ".claude", "projects", "p"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, ".claude", "projects", "p", "s1.jsonl"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "claude"), []byte("#!/bin/sh\necho \"$@\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	run := func(session, at, fork string) string {
		cmd := exec.Command("sh", "-c", DefaultAgent)
		cmd.Env = []string{"HOME=" + home, "PATH=" + bin + ":/usr/bin:/bin", "KIMONO_PROMPT=hi", "KIMONO_MODEL=m", "KIMONO_SYSTEM=s", "KIMONO_SESSION=" + session, "KIMONO_RESUME_AT=" + at, "KIMONO_FORK=" + fork}
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("agent: %v: %s", err, out)
		}
		return string(out)
	}
	if got := run("s1", "u1", "1"); !strings.Contains(got, "--resume s1 --resume-session-at u1 --fork-session") {
		t.Fatalf("a second take should fork the session at the message before the ask: %s", got)
	}
	if got := run("s1", "", ""); strings.Contains(got, "--fork-session") {
		t.Fatalf("an ordinary turn carries its session on: %s", got)
	}
	if got := run("", "", "1"); strings.Contains(got, "--fork-session") || strings.Contains(got, "--resume") {
		t.Fatalf("a first message has nothing to fork: %s", got)
	}
}
