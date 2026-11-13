package sandbox

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func ids(boxes []awakeBox) []string {
	var out []string
	for _, b := range boxes {
		out = append(out, b.id)
	}
	return out
}

func TestPlanRoom(t *testing.T) {
	minute := time.Minute
	akram := func(id string, quiet time.Duration, busy bool) awakeBox {
		return awakeBox{id: id, owner: "akram", title: "Task " + id, quiet: quiet, busy: busy}
	}
	sara := func(id string, quiet time.Duration, busy bool) awakeBox {
		return awakeBox{id: id, owner: "sara", title: "Task " + id, quiet: quiet, busy: busy}
	}

	// Room to spare: nothing sleeps.
	if evict, refused := planRoom([]awakeBox{akram("a", minute, false)}, "akram", 2, 6); refused != nil || len(evict) != 0 {
		t.Fatalf("room to spare: %v %v", ids(evict), refused)
	}
	// At the person's cap: their least recently used idle one sleeps, not someone else's.
	evict, refused := planRoom([]awakeBox{akram("recent", minute, false), akram("old", 9*minute, false), sara("older", 30*minute, false)}, "akram", 2, 6)
	if refused != nil || !reflect.DeepEqual(ids(evict), []string{"old"}) {
		t.Fatalf("person cap: %v %v", ids(evict), refused)
	}
	// A working sandbox is never put to sleep, however old.
	evict, refused = planRoom([]awakeBox{akram("working", 60*minute, true), akram("idle", minute, false)}, "akram", 2, 6)
	if refused != nil || !reflect.DeepEqual(ids(evict), []string{"idle"}) {
		t.Fatalf("busy kept: %v %v", ids(evict), refused)
	}
	// Everything of theirs working: refused, naming the tasks that hold the slots.
	_, refused = planRoom([]awakeBox{akram("x", minute, true), akram("y", minute, true)}, "akram", 2, 6)
	if refused == nil || !refused.perPerson || !strings.Contains(refused.message(), "“Task x”") || !strings.Contains(refused.message(), "2 tasks awake") {
		t.Fatalf("person refusal: %+v", refused)
	}
	// The node cap takes anyone's least recently used idle sandbox.
	evict, refused = planRoom([]awakeBox{sara("s1", 5*minute, false), sara("s2", 20*minute, false), akram("a1", 40*minute, true)}, "akram", 2, 3)
	if refused != nil || !reflect.DeepEqual(ids(evict), []string{"s2"}) {
		t.Fatalf("node cap: %v %v", ids(evict), refused)
	}
	// One sleep can satisfy both caps.
	evict, refused = planRoom([]awakeBox{akram("a1", 50*minute, false), akram("a2", minute, true), sara("s1", 5*minute, false)}, "akram", 2, 3)
	if refused != nil || !reflect.DeepEqual(ids(evict), []string{"a1"}) {
		t.Fatalf("both caps: %v %v", ids(evict), refused)
	}
	// The node full of work: refused, with owners named.
	_, refused = planRoom([]awakeBox{sara("s1", minute, true), sara("s2", minute, true)}, "akram", 2, 2)
	if refused == nil || refused.perPerson || !strings.Contains(refused.message(), "(sara)") {
		t.Fatalf("node refusal: %+v", refused)
	}
	// A sandbox with no known owner still counts for the node.
	evict, _ = planRoom([]awakeBox{{id: "old", quiet: time.Hour}}, "", 2, 1)
	if !reflect.DeepEqual(ids(evict), []string{"old"}) {
		t.Fatalf("unowned: %v", ids(evict))
	}
}

func TestLimits(t *testing.T) {
	for raw, want := range map[string]int{"2g": 2048, "512m": 512, "1.5g": 1536, "2147483648": 2048} {
		if got, ok := parseMemory(raw); !ok || got != want {
			t.Errorf("parseMemory(%q) = %d, %v", raw, got, ok)
		}
	}
	if _, ok := parseMemory("lots"); ok {
		t.Error("nonsense memory accepted")
	}
	base := Limits{CPUs: 1, MemoryMB: 2048, AwakePerPerson: 6, AwakePerNode: 12, DiskGB: 10}
	merged := base.merge(&Limits{CPUs: 2, MemoryMB: 64, AwakePerPerson: 3, DiskGB: 0})
	if merged != (Limits{CPUs: 2, MemoryMB: 2048, AwakePerPerson: 3, AwakePerNode: 12, DiskGB: 10}) {
		t.Errorf("merge kept the wrong fields: %+v", merged)
	}
	if args := base.dockerArgs(); !reflect.DeepEqual(args, []string{"--cpus", "1", "--memory", "2048m", "--memory-swap", "2048m"}) {
		t.Errorf("docker args %v", args)
	}
	if base.diskCeiling() != 11<<30 {
		t.Errorf("ceiling %d", base.diskCeiling())
	}
	if prompt := limitsPrompt(base, false); !strings.Contains(prompt, "1 CPU, 2 GB of memory with no swap, and 10 GB of disk") {
		t.Errorf("prompt %q", prompt)
	}
	if diskNote(9<<30, base) != "" || !strings.Contains(diskNote(10<<30+600<<20, base), "10.6 GB of the 10 GB") {
		t.Errorf("disk note: %q", diskNote(10<<30+600<<20, base))
	}
	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	if s.limitsNow() != base {
		t.Errorf("node defaults %+v", s.limitsNow())
	}
}

// TestMakeRoomStopsTheOldest runs the eviction against a fake Docker: the
// person's least recently used idle sandbox is stopped, and nothing else.
func TestMakeRoomStopsTheOldest(t *testing.T) {
	dir := t.TempDir()
	calls := filepath.Join(dir, "calls")
	fake := filepath.Join(dir, "docker")
	script := `#!/bin/sh
echo "$@" >> ` + calls + `
case "$1" in
  ps) printf 'old running\nnew running\nother paused\nmine exited\n' ;;
  container) echo running ;;
esac
`
	if err := os.WriteFile(fake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	s, _ := New(Config{Key: "k", StateDir: dir, Docker: fake, AwakePerPerson: 2})
	s.docker = docker{bin: fake}
	s.now = func() time.Time { return now }
	s.records = map[string]*record{
		"old":   {Owner: "akram", Title: "Old", Last: now.Add(-time.Hour)},
		"new":   {Owner: "akram", Title: "New", Last: now.Add(-time.Minute)},
		"other": {Owner: "sara", Title: "Hers", Last: now.Add(-2 * time.Hour)},
		"mine":  {Owner: "akram", Title: "Waking", Last: now},
	}
	slept, err := s.makeRoom(t.Context(), "mine")
	if err != nil || !reflect.DeepEqual(slept, []string{"old"}) {
		t.Fatalf("slept %v, %v", slept, err)
	}
	log, _ := os.ReadFile(calls)
	if !strings.Contains(string(log), "stop -t 5 kimono-sbx-old") || strings.Contains(string(log), "kimono-sbx-other") {
		t.Fatalf("docker calls:\n%s", log)
	}
}
