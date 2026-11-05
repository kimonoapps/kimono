package sandbox

import (
	"testing"
	"time"
)

func sleepConfig() Config {
	return Config{PauseAfter: time.Minute, StopAfter: 15 * time.Minute, RemoveAfter: 7 * 24 * time.Hour}
}

func TestDecide(t *testing.T) {
	cfg := sleepConfig()
	for _, c := range []struct {
		state string
		busy  bool
		quiet time.Duration
		want  sleepAction
	}{
		{"running", false, 59 * time.Second, stayAwake},
		{"running", false, time.Minute, pauseIt},
		{"running", true, time.Hour, stayAwake},
		{"running", false, 15 * time.Minute, stopIt},
		{"running", false, 8 * 24 * time.Hour, removeIt},
		{"paused", false, 2 * time.Minute, stayAwake},
		{"paused", false, 16 * time.Minute, stopIt},
		{"paused", false, 8 * 24 * time.Hour, removeIt},
		{"exited", false, time.Hour, stayAwake},
		{"exited", false, 8 * 24 * time.Hour, removeIt},
		{"created", false, 8 * 24 * time.Hour, removeIt},
		{"restarting", false, 8 * 24 * time.Hour, stayAwake},
	} {
		if got := decide(c.state, c.busy, c.quiet, cfg); got != c.want {
			t.Errorf("decide(%s, busy=%v, %s) = %q, want %q", c.state, c.busy, c.quiet, got, c.want)
		}
	}
	cfg.RemoveAfter = 0
	if got := decide("exited", false, 365*24*time.Hour, cfg); got != stayAwake {
		t.Errorf("RemoveAfter 0 still removed: %q", got)
	}
}

func TestSleepDefaults(t *testing.T) {
	cfg := Config{Key: "k", StopAfter: time.Second, RemoveAfter: time.Second}
	if err := cfg.defaults(); err != nil {
		t.Fatal(err)
	}
	if cfg.PauseAfter != time.Minute || cfg.StopAfter != time.Minute || cfg.RemoveAfter != time.Minute {
		t.Errorf("each step must come no earlier than the last: %s %s %s", cfg.PauseAfter, cfg.StopAfter, cfg.RemoveAfter)
	}
}

func TestQuietFor(t *testing.T) {
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	s := &Server{cfg: Config{StateDir: t.TempDir(), Logf: func(string, ...any) {}}, spaces: map[string]*workspace{}, records: map[string]*record{}, now: func() time.Time { return now }}
	s.started = now.Add(-10 * time.Minute)

	// Unknown to this node: quiet since the node started, never longer.
	if quiet, _ := s.quietFor("stranger", now); quiet != 10*time.Minute {
		t.Errorf("unknown sandbox quiet for %s", quiet)
	}
	// Used before this node ever ensured it (a preview opened after a restart): that counts.
	s.touch("stranger")
	if quiet, _ := s.quietFor("stranger", now); quiet != 0 {
		t.Errorf("touched stranger quiet for %s", quiet)
	}
	// Kept from before a restart: the record counts, so an old sandbox doesn't look fresh.
	s.records["old"] = &record{Last: now.Add(-3 * time.Hour)}
	if quiet, _ := s.quietFor("old", now); quiet != 3*time.Hour {
		t.Errorf("recorded sandbox quiet for %s", quiet)
	}
	// Touching moves both, and the latest wins.
	s.spaces["old"] = &workspace{id: "old"}
	s.touch("old")
	if quiet, _ := s.quietFor("old", now); quiet > time.Second {
		t.Errorf("touched sandbox quiet for %s", quiet)
	}
	// A running turn is never quiet, however long ago it began.
	s.spaces["busy"] = &workspace{id: "busy", busy: true, lastActive: now.Add(-time.Hour)}
	if _, busy := s.quietFor("busy", now); !busy {
		t.Error("a running turn wasn't reported busy")
	}
}

func TestRecordsSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	clock := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	first := &Server{cfg: Config{StateDir: dir, Logf: func(string, ...any) {}}, records: map[string]*record{}, now: func() time.Time { return clock }}
	first.remember("abc", Repo{URL: "https://git.example.com/a/b.git", Owner: "a", Name: "b", Base: "main", Branch: "code/x"}, "akram", "Recipes")
	second := &Server{cfg: Config{StateDir: dir, Logf: func(string, ...any) {}}, records: map[string]*record{}}
	second.loadRecords()
	r := second.records["abc"]
	if r == nil || r.Repo.Owner != "a" || r.Repo.Branch != "code/x" || r.Owner != "akram" || r.Title != "Recipes" || !r.Last.Equal(clock) {
		t.Fatalf("record after restart: %+v", r)
	}
	second.now = time.Now
	second.forget("abc")
	third := &Server{cfg: Config{StateDir: dir, Logf: func(string, ...any) {}}, records: map[string]*record{}}
	third.loadRecords()
	if len(third.records) != 0 {
		t.Error("a forgotten sandbox came back")
	}
}

func TestSweepEvery(t *testing.T) {
	for pause, want := range map[time.Duration]time.Duration{time.Minute: 10 * time.Second, 10 * time.Second: 1666666666 * time.Nanosecond, time.Second: time.Second, time.Hour: 10 * time.Second} {
		s := &Server{cfg: Config{PauseAfter: pause}}
		if got := s.sweepEvery(); got != want {
			t.Errorf("sweepEvery for %s = %s, want %s", pause, got, want)
		}
	}
}
