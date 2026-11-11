package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// sample makes a 30-second Matroska file with a keyframe every 2 seconds.
func sample(t *testing.T) string {
	t.Helper()
	bin, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("ffmpeg isn't installed")
	}
	ffmpegPath = bin
	path := filepath.Join(t.TempDir(), "sample.mkv")
	cmd := exec.Command(bin, "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24", "-f", "lavfi", "-i", "sine=r=48000",
		"-f", "lavfi", "-i", "anullsrc", "-t", "30", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-bf", "3", "-g", "48", "-keyint_min", "48",
		"-c:a", "aac", "-y", path)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("making the sample: %v %s", err, out)
	}
	return path
}

func fileFetcher(t *testing.T, path string) fetcher {
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return func(off, n int64) ([]byte, error) {
		if off >= int64(len(data)) {
			return nil, nil
		}
		end := min(off+n, int64(len(data)))
		return data[off:end], nil
	}
}

func TestKeyframesFromCues(t *testing.T) {
	frames, err := matroskaKeyframes(fileFetcher(t, sample(t)))
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 15 || frames[0] != 0 || frames[1] != 2 || frames[14] != 28 {
		t.Fatalf("keyframes: %v", frames)
	}
}

func fragmentsFrom(t *testing.T, path string, start string) ([]byte, []fragment) {
	t.Helper()
	cmd := exec.Command(ffmpegPath, "-v", "error", "-ss", start, "-i", path, "-copyts", "-start_at_zero", "-avoid_negative_ts", "disabled",
		"-map", "0:v", "-map", "0:a", "-c", "copy", "-movflags", "frag_keyframe+delay_moov+default_base_moof+frag_discont+negative_cts_offsets",
		"-use_editlist", "0", "-f", "mp4", "pipe:1")
	out, err := cmd.Output()
	if err != nil {
		t.Fatal(err)
	}
	var init []byte
	var frags []fragment
	if err := splitFragments(bytes.NewReader(out), func(b []byte) { init = b }, func(f fragment) { frags = append(frags, f) }); err != nil {
		t.Fatal(err)
	}
	return init, frags
}

func TestFragmentsKeepTheirTimes(t *testing.T) {
	path := sample(t)
	init0, from0 := fragmentsFrom(t, path, "0")
	init20, from20 := fragmentsFrom(t, path, "20.25")
	if !bytes.Equal(init0, init20) {
		t.Fatal("the init segment changed with the starting point")
	}
	if len(from0) != 15 || from0[1].time != 2 {
		t.Fatalf("fragments from 0: %d, second at %v", len(from0), from0[1].time)
	}
	if from0[0].end != 2 || from0[14].end < 29.9 {
		t.Fatalf("fragment ends: %v, %v", from0[0].end, from0[14].end)
	}
	if from20[0].time != 20 {
		t.Fatalf("starting at 20.25 began at %v", from20[0].time)
	}
}

func TestCues(t *testing.T) {
	var cues []cue
	input := "WEBVTT\n\n00:00:01.000 --> 00:00:03.500 line:90%\nHello\nthere\n\n1\n00:00:07.000 --> 00:00:08.000\nBye\n\n"
	if err := readCues(strings.NewReader(input), func(c cue) { cues = addCue(cues, c) }); err != nil {
		t.Fatal(err)
	}
	cues = addCue(cues, cues[0])
	if len(cues) != 2 || cues[0].settings != "line:90%" || cues[0].text != "Hello\nthere" {
		t.Fatalf("cues: %+v", cues)
	}
	got := string(vttSegment(cues, 0, 6))
	if !strings.Contains(got, "00:00:01.000 --> 00:00:03.500 line:90%\nHello\nthere") || strings.Contains(got, "Bye") {
		t.Fatalf("segment: %q", got)
	}
}

func TestProbeFailuresAreSlowOrUnreadable(t *testing.T) {
	cases := map[error]string{
		&statusError{404}:                            "unreadable",
		&statusError{410}:                            "unreadable",
		&statusError{429}:                            "slow",
		&statusError{502}:                            "slow",
		&unreadableError{"tiny"}:                     "unreadable",
		context.DeadlineExceeded:                     "slow",
		fmt.Errorf("wrapped: %w", &statusError{403}): "unreadable",
		errors.New("connection refused"):             "slow",
	}
	for err, want := range cases {
		if got := classify(err); got != want {
			t.Errorf("%v: %s, want %s", err, got, want)
		}
	}
}

func TestEvictKeepsWhatsNearTheViewer(t *testing.T) {
	dir := t.TempDir()
	s := &Session{dir: dir, ready: map[string]map[int]bool{"v0": {}}, sizes: map[string]map[int]int64{"v0": {}}, lastReq: 100}
	if err := os.MkdirAll(filepath.Join(dir, "v0"), 0o700); err != nil {
		t.Fatal(err)
	}
	for k := 0; k <= 110; k++ {
		s.ready["v0"][k] = true
		s.sizes["v0"][k] = 50 << 20
	}
	s.evictLocked() // 111 × 50 MB is over 4 GB: the oldest go until it fits
	var total int64
	for _, size := range s.sizes["v0"] {
		total += size
	}
	if total > keepBytes {
		t.Fatalf("still %d bytes", total)
	}
	if s.ready["v0"][0] {
		t.Fatal("the farthest segment behind was kept")
	}
	for k := 100 - keepBehind; k <= 110; k++ {
		if !s.ready["v0"][k] {
			t.Fatalf("segment %d, near the viewer or ahead, was deleted", k)
		}
	}
	s.lastReq = 50
	before := len(s.ready["v0"])
	s.evictLocked()
	if len(s.ready["v0"]) != before {
		t.Fatal("deleted more once under the budget")
	}
}

func TestSlowRunsStartOverRatherThanCatchUp(t *testing.T) {
	segments := make([]float64, 100)
	for k := range segments {
		segments[k] = float64(k) * 6
	}
	s := &Session{spec: Spec{Segments: segments, Duration: 600, Outputs: []Output{{Name: "v0", Kind: "fmp4"}}}}
	/* Started at 10, first segment in 2 s, then three more in 6 s: half the film's speed. */
	at := func(pace time.Duration) *run {
		return &run{start: 10, progress: map[string]int{"v0": 13}, began: time.Now().Add(-2*time.Second - pace), firstAt: 2 * time.Second, firstEnd: s.end(10)}
	}
	s.run = at(36 * time.Second) // 18 s of film in 36 s
	if !s.needsRestart(15, true) {
		t.Fatal("waited 12 s of film at half speed instead of starting over")
	}
	s.run = at(3 * time.Second) // six times the film's speed
	if s.needsRestart(15, true) {
		t.Fatal("started over when the run would get there in 2 s")
	}
	if !s.needsRestart(30, true) {
		t.Fatal("waited past the gap")
	}
}
