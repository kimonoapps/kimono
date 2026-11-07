package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These run the sandbox's own kimono-progress (infra/sandbox/bin) with python3,
// its jobs kept in a temporary folder.
func progressScript(t *testing.T) func(args ...string) (string, error) {
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
	return func(args ...string) (string, error) {
		cmd := exec.Command(python, append([]string{script}, args...)...)
		cmd.Env = append(os.Environ(), "KIMONO_PROGRESS_DIR="+dir)
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
}

// --run starts the work in the background and --wait comes back as soon as it
// ends, long before the time it was given.
func TestProgressRunWaitReturnsWhenTheJobEnds(t *testing.T) {
	progress := progressScript(t)
	out, err := progress("Rendering", "--about", "30", "--run", "sleep 1; echo 'frame 300/300'; echo done")
	if err != nil || !strings.Contains(out, "running in the background") {
		t.Fatalf("start: %v %s", err, out)
	}
	began := time.Now()
	out, err = progress("--wait", "60")
	if err != nil {
		t.Fatalf("wait: %v %s", err, out)
	}
	if took := time.Since(began); took > 15*time.Second {
		t.Fatalf("--wait took %s; it should end with the job", took)
	}
	if !strings.Contains(out, "It finished") || !strings.Contains(out, "done") || !strings.Contains(out, "kimono-progress --done") {
		t.Fatalf("wait said: %s", out)
	}
}

// A job still running is reported with its last line, the percent it printed,
// and the one command to run next.
func TestProgressRunWaitReportsAPercent(t *testing.T) {
	progress := progressScript(t)
	if out, err := progress("Drawing the frames", "--about", "60", "--run", "echo 'frame 120/300'; printf 'Drawing 10%%\\rDrawing 35%%\\n'; sleep 30"); err != nil {
		t.Fatalf("start: %v %s", err, out)
	}
	out, err := progress("--wait", "2")
	if err != nil {
		t.Fatalf("wait: %v %s", err, out)
	}
	for _, want := range []string{"Still running", "35% by its output", "Drawing 35%", `--percent 35; kimono-progress --wait`} {
		if !strings.Contains(out, want) {
			t.Fatalf("wait doesn't say %q: %s", want, out)
		}
	}
	if strings.Contains(out, "Drawing 10%") {
		t.Fatalf("a redrawn bar shows only its latest drawing: %s", out)
	}
}

// A failing job says so, with its exit code, even when the command exits early
// or chains its own steps.
func TestProgressRunReportsAFailure(t *testing.T) {
	progress := progressScript(t)
	if out, err := progress("Joining clips", "--about", "20", "--run", "echo 'No such file: a.mp4'; exit 3; echo never"); err != nil {
		t.Fatalf("start: %v %s", err, out)
	}
	out, _ := progress("--wait", "20")
	if !strings.Contains(out, "failed (exit 3)") || !strings.Contains(out, "No such file") || strings.Contains(out, "never") {
		t.Fatalf("wait said: %s", out)
	}
}

// With nothing of its own running (a Pro Tool's job), --wait just waits, and
// an old finished job isn't reported again.
func TestProgressWaitWithoutAJob(t *testing.T) {
	progress := progressScript(t)
	out, err := progress("--wait", "1")
	if err != nil || !strings.Contains(out, "Waited 1 s") {
		t.Fatalf("plain wait: %v %s", err, out)
	}
	if out, err := progress("Quick", "--about", "5", "--run", "true"); err != nil {
		t.Fatalf("start: %v %s", err, out)
	}
	progress("--wait", "10")
	if out, _ := progress("--wait", "1"); !strings.Contains(out, "Waited 1 s") {
		t.Fatalf("a finished job is reported again: %s", out)
	}
}

// A start still needs its estimate, and --run needs a command.
func TestProgressStartChecksItsWords(t *testing.T) {
	progress := progressScript(t)
	for _, args := range [][]string{
		{"Rendering"},
		{"Rendering", "--run", "true"},
		{"Rendering", "--about", "2"},
		{"Rendering", "--about", "30", "--run", " "},
		{"Rendering", "--about", "30", "--later"},
		{"--status", ""},
		{"--status", "Rendering", "--percent", "120"},
	} {
		if out, err := progress(args...); err == nil {
			t.Errorf("%q was accepted: %s", args, out)
		}
	}
	if out, err := progress("Making your video", "--about", "150"); err != nil || !strings.Contains(out, "Started: Making your video") {
		t.Fatalf("a plain start: %v %s", err, out)
	}
}
