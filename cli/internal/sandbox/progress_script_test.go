package sandbox

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These run the sandbox's own kimono-progress (infra/sandbox/bin) with python3,
// its card's state and its jobs kept in a temporary folder.
type progressCard struct {
	Job     string   `json:"job"`
	Label   string   `json:"label"`
	State   string   `json:"state"`
	Status  *string  `json:"status"`
	Percent *float64 `json:"percent"`
	Left    *float64 `json:"left"`
}

type progressRig struct {
	t     *testing.T
	state string
	run   func(args ...string) (string, error)
}

func newProgressRig(t *testing.T) *progressRig {
	t.Helper()
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 isn't here")
	}
	script, _ := filepath.Abs("../../../infra/sandbox/bin/kimono-progress")
	if _, err := os.Stat(script); err != nil {
		t.Skip("kimono-progress isn't beside this checkout")
	}
	dir := t.TempDir()
	rig := &progressRig{t: t, state: filepath.Join(dir, ".kimono", "progress.json")}
	rig.run = func(args ...string) (string, error) {
		cmd := exec.Command(python, append([]string{script}, args...)...)
		cmd.Env = append(os.Environ(), "KIMONO_PROGRESS_FILE="+rig.state, "KIMONO_PROGRESS_DIR="+filepath.Join(dir, "jobs"))
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	// Background watchers end once their card is replaced or finished.
	t.Cleanup(func() { os.Remove(rig.state) })
	return rig
}

func (r *progressRig) must(args ...string) string {
	r.t.Helper()
	out, err := r.run(args...)
	if err != nil {
		r.t.Fatalf("kimono-progress %q: %v %s", args, err, out)
	}
	return out
}

func (r *progressRig) card() progressCard {
	var c progressCard
	body, err := os.ReadFile(r.state)
	if err == nil {
		json.Unmarshal(body, &c)
	}
	return c
}

// until waits for the card to reach what ok wants, as Kimono's probe would see it.
func (r *progressRig) until(what string, ok func(progressCard) bool) progressCard {
	r.t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if c := r.card(); ok(c) {
			return c
		}
		time.Sleep(100 * time.Millisecond)
	}
	r.t.Fatalf("the card never showed %s: %+v", what, r.card())
	return progressCard{}
}

func pct(c progressCard) float64 {
	if c.Percent == nil {
		return -1
	}
	return *c.Percent
}

func words(c progressCard) string {
	if c.Status == nil {
		return ""
	}
	return *c.Status
}

// A start writes the card at once: what it's doing, running, no percent yet,
// and no estimate is needed.
func TestProgressStartWritesTheCard(t *testing.T) {
	r := newProgressRig(t)
	r.must("Making your video")
	c := r.card()
	if c.Label != "Making your video" || c.State != "running" || c.Percent != nil || c.Job == "" {
		t.Fatalf("card: %+v", c)
	}
	r.must("Older habit", "--about", "150")
	if r.card().Label != "Older habit" {
		t.Fatal("--about is still accepted")
	}
}

// A --run job's own PROGRESS lines move the card while it runs, with no help
// from the agent, and the card ends done when the command does.
func TestProgressRunFollowsItsOwnOutput(t *testing.T) {
	r := newProgressRig(t)
	r.must("Drawing the frames", "--run", "echo 'PROGRESS 10 Setting up'; sleep 1.5; echo 'PROGRESS 120/300 Drawing frames'; sleep 1.5; echo done")
	c := r.until("10% while setting up", func(c progressCard) bool { return pct(c) == 10 })
	if words(c) != "Setting up" || c.State != "running" {
		t.Fatalf("card: %+v", c)
	}
	c = r.until("40% from 120/300", func(c progressCard) bool { return pct(c) == 40 })
	if words(c) != "Drawing frames" {
		t.Fatalf("status: %q", words(c))
	}
	c = r.until("done", func(c progressCard) bool { return c.State == "done" })
	if pct(c) != 100 {
		t.Fatalf("done at %v%%", pct(c))
	}
}

// Without PROGRESS lines it reads an ordinary bar ("35%", redrawn with \r) or a count.
func TestProgressRunReadsOrdinaryOutput(t *testing.T) {
	r := newProgressRig(t)
	r.must("Encoding", "--run", `printf 'frame 3/4\n'; sleep 1.5; printf 'Encoding 10%%\rEncoding 35%%\n'; sleep 30`)
	r.until("75% from frame 3/4", func(c progressCard) bool { return pct(c) == 75 })
	r.until("35%, the bar's latest drawing", func(c progressCard) bool { return pct(c) == 35 })
}

// A failing job shows on the card as failed, with what it last said, and
// --wait says so as soon as it ends.
func TestProgressRunFailure(t *testing.T) {
	r := newProgressRig(t)
	r.must("Joining clips", "--run", "echo 'No such file: a.mp4'; exit 3; echo never")
	began := time.Now()
	out := r.must("--wait", "30")
	if time.Since(began) > 10*time.Second {
		t.Fatal("--wait should end with the job")
	}
	if !strings.Contains(out, "failed (exit 3)") || !strings.Contains(out, "No such file") || strings.Contains(out, "never") {
		t.Fatalf("wait said: %s", out)
	}
	c := r.until("failed", func(c progressCard) bool { return c.State == "failed" })
	if words(c) != "No such file: a.mp4" {
		t.Fatalf("status: %q", words(c))
	}
	// Told once: the next wait is a plain wait.
	if out := r.must("--wait", "1"); !strings.Contains(out, "Waited 1 s") {
		t.Fatalf("a finished job was reported again: %s", out)
	}
}

// --wait comes back the moment the job ends, and the card is already done.
func TestProgressWaitEndsWithTheJob(t *testing.T) {
	r := newProgressRig(t)
	r.must("Rendering", "--run", "sleep 1; echo ok")
	began := time.Now()
	out := r.must("--wait", "60")
	if time.Since(began) > 10*time.Second || !strings.Contains(out, "It finished") {
		t.Fatalf("wait (%s): %s", time.Since(began), out)
	}
	r.until("done", func(c progressCard) bool { return c.State == "done" })
}

// A probe the agent wrote for its own work is run again and again; the card
// follows it and ends when it reaches 100.
func TestProgressProbe(t *testing.T) {
	r := newProgressRig(t)
	frames := filepath.Join(t.TempDir(), "frames")
	os.MkdirAll(frames, 0o755)
	r.must("Drawing frames", "--probe", "echo $(ls "+frames+" | wc -l)/4")
	for i, want := range []float64{25, 50, 100} {
		for n := 0; n < map[int]int{0: 1, 1: 1, 2: 2}[i]; n++ {
			os.WriteFile(filepath.Join(frames, time.Now().Format("150405.000000000")), nil, 0o644)
		}
		r.until("the probe's count", func(c progressCard) bool { return pct(c) == want })
	}
	r.until("done at 100", func(c progressCard) bool { return c.State == "done" })
}

// What a Pro Tool says is reported with --status; --done ends the card.
func TestProgressStatusAndDone(t *testing.T) {
	r := newProgressRig(t)
	if _, err := r.run("--status", "Rendering"); err == nil {
		t.Fatal("a status with no card was accepted")
	}
	r.must("Making your video")
	r.must("--status", "In queue", "--left", "120")
	if c := r.card(); words(c) != "In queue" || c.Left == nil || *c.Left != 120 || c.Percent != nil {
		t.Fatalf("card: %+v", c)
	}
	r.must("--status", "Rendering", "--percent", "60")
	if c := r.card(); words(c) != "Rendering" || pct(c) != 60 || c.Left != nil {
		t.Fatalf("each status replaces the last: %+v", c)
	}
	r.must("--done", "Video ready")
	if c := r.card(); c.State != "done" || words(c) != "Video ready" || pct(c) != 100 {
		t.Fatalf("card: %+v", c)
	}
	if _, err := r.run("--status", "Late"); err == nil {
		t.Fatal("a finished card took a status")
	}
}

// A new card replaces the old one, and the old job's watcher never touches it.
func TestProgressNewCardIsLeftAlone(t *testing.T) {
	r := newProgressRig(t)
	r.must("First", "--run", "sleep 1; echo 'PROGRESS 90 old'")
	r.must("Second")
	time.Sleep(3 * time.Second)
	if c := r.card(); c.Label != "Second" || c.State != "running" || c.Percent != nil {
		t.Fatalf("the old job changed the new card: %+v", c)
	}
}

// Bad words are refused, with a reason.
func TestProgressRefusesBadWords(t *testing.T) {
	r := newProgressRig(t)
	r.must("Card")
	for _, args := range [][]string{
		{"--percent", "5"},
		{"Rendering", "--run", " "},
		{"Rendering", "--probe", ""},
		{"Rendering", "--later", "x"},
		{"--status", ""},
		{"--status", "Rendering", "--percent", "120"},
		{"--status", "Rendering", "--left", "-1"},
		{"--wait", "soon"},
	} {
		if out, err := r.run(args...); err == nil {
			t.Errorf("%q was accepted: %s", args, out)
		}
	}
}
