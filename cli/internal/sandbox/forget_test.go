package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestForgetQuiet: a sandbox whose container is gone and that nobody used for
// ForgetAfter loses its volume and its record; a recent one, one still with a
// container, and every one when ForgetAfter is 0, keep theirs.
func TestForgetQuiet(t *testing.T) {
	dir := t.TempDir()
	calls := filepath.Join(dir, "calls")
	fake := filepath.Join(dir, "docker")
	script := `#!/bin/sh
echo "$*" >> "` + calls + `"
case "$*" in
  *"container inspect"*) echo "Error: No such container" >&2; exit 1 ;;
esac
`
	if err := os.WriteFile(fake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 6, 12, 0, 0, 0, time.UTC)
	s := &Server{cfg: Config{StateDir: dir, ForgetAfter: 90 * 24 * time.Hour, Logf: func(string, ...any) {}}, docker: docker{bin: fake},
		records: map[string]*record{}, spaces: map[string]*workspace{}, wakeLocks: map[string]*sync.Mutex{}, now: func() time.Time { return now }}
	s.records["old"] = &record{Last: now.Add(-100 * 24 * time.Hour)}
	s.records["recent"] = &record{Last: now.Add(-10 * 24 * time.Hour)}
	s.records["awake"] = &record{Last: now.Add(-200 * 24 * time.Hour)}

	s.forgetQuiet(context.Background(), map[string]string{"awake": "exited"}, now)

	raw, _ := os.ReadFile(calls)
	if !strings.Contains(string(raw), "volume rm -f "+containerName("old")) {
		t.Fatalf("the old sandbox's volume wasn't removed:\n%s", raw)
	}
	if strings.Contains(string(raw), containerName("recent")) || strings.Contains(string(raw), "volume rm -f "+containerName("awake")) {
		t.Fatalf("removed more than it should:\n%s", raw)
	}
	if s.records["old"] != nil || s.records["recent"] == nil || s.records["awake"] == nil {
		t.Fatalf("records after: old %v, recent %v, awake %v", s.records["old"] != nil, s.records["recent"] != nil, s.records["awake"] != nil)
	}

	os.Remove(calls)
	s.cfg.ForgetAfter = 0
	s.records["old"] = &record{Last: now.Add(-1000 * 24 * time.Hour)}
	s.forgetQuiet(context.Background(), map[string]string{}, now)
	if raw, _ := os.ReadFile(calls); len(raw) != 0 || s.records["old"] == nil {
		t.Fatalf("ForgetAfter 0 still forgot: %s", raw)
	}
}
