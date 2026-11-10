package main

// A session is one viewer's stream: the Portal describes it (the ffmpeg
// arguments, the outputs, where each segment starts) and the packager runs
// ffmpeg around wherever the viewer is. A request for a segment the encoder
// isn't near restarts it there; the encoder pauses once it is far enough
// ahead of the requests, segments well behind are deleted, and a session
// nobody has asked anything of for a minute is stopped and removed.

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Output struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // "fmp4" or "vtt"
}

type Spec struct {
	Input    string     `json:"input"`
	Args     []string   `json:"args"`
	Fallback []string   `json:"fallback,omitempty"`
	Prepare  [][]string `json:"prepare,omitempty"`
	Outputs  []Output   `json:"outputs"`
	Segments []float64  `json:"segments"`
	Duration float64    `json:"duration"`
	// Seconds added to a segment's start when seeking, so a copied stream
	// lands on that keyframe rather than the one before.
	SeekPad float64 `json:"seekPad,omitempty"`
	// Seconds produced past the latest request before the encoder pauses.
	Ahead float64 `json:"ahead,omitempty"`
}

const (
	idleAfter   = 60 * time.Second
	waitFor     = 100 * time.Second
	restartGap  = 24.0 // seconds past the encoder's progress worth waiting for
	keepBehind  = 8    // segments kept behind the latest request
	maxFailures = 2
)

var errGone = errors.New("no such segment")

type run struct {
	cmd      *exec.Cmd
	start    int
	progress map[string]int // last finished segment per fmp4 output
	tails    map[string]*pendingSegment
	killed   bool
	done     bool
	ok       bool
	produced bool
	paused   bool
	stderr   *tail
	readers  sync.WaitGroup
}

type pendingSegment struct {
	index int
	data  []byte
}

type Session struct {
	id   string
	spec Spec
	dir  string

	mu         sync.Mutex
	changed    chan struct{}
	run        *run
	ready      map[string]map[int]bool
	inits      map[string]bool
	cues       map[string][]cue
	covered    map[int]bool
	failures   map[int]int
	lastReq    int
	lastAccess time.Time
	fallback   bool
	prepared   bool
	preparing  bool
	pendingAt  int
	closed     bool
	problem    string
	// Only the newest request moves the encoder: one a player gave up on
	// (it seeks away and aborts) must not drag it back.
	seq int
}

func newSession(id string, spec Spec, root string) (*Session, error) {
	if spec.Input == "" || len(spec.Args) == 0 || len(spec.Outputs) == 0 || len(spec.Segments) == 0 {
		return nil, errors.New("incomplete session")
	}
	if spec.Ahead <= 0 {
		spec.Ahead = 45
	}
	dir := filepath.Join(root, id)
	for _, o := range spec.Outputs {
		if err := os.MkdirAll(filepath.Join(dir, o.Name), 0o700); err != nil {
			return nil, err
		}
	}
	s := &Session{
		id: id, spec: spec, dir: dir, changed: make(chan struct{}),
		ready: map[string]map[int]bool{}, inits: map[string]bool{}, cues: map[string][]cue{},
		covered: map[int]bool{}, failures: map[int]int{}, lastAccess: time.Now(), prepared: len(spec.Prepare) == 0,
	}
	for _, o := range spec.Outputs {
		s.ready[o.Name] = map[int]bool{}
	}
	go s.tick()
	return s, nil
}

func (s *Session) notify() {
	close(s.changed)
	s.changed = make(chan struct{})
}

func (s *Session) output(name string) (Output, bool) {
	for _, o := range s.spec.Outputs {
		if o.Name == name {
			return o, true
		}
	}
	return Output{}, false
}

// index is the planned segment that time t (seconds) falls in.
func (s *Session) index(t float64) int {
	return sort.Search(len(s.spec.Segments), func(i int) bool { return s.spec.Segments[i] > t+0.05 }) - 1
}

func (s *Session) end(k int) float64 {
	if k+1 < len(s.spec.Segments) {
		return s.spec.Segments[k+1]
	}
	return s.spec.Duration
}

func (s *Session) progressOf(r *run) int {
	low := -1
	first := true
	for _, o := range s.spec.Outputs {
		if o.Kind != "fmp4" {
			continue
		}
		p, ok := r.progress[o.Name]
		if !ok {
			p = r.start - 1
		}
		if first || p < low {
			low, first = p, false
		}
	}
	return low
}

func (s *Session) path(name string, k int) string {
	return filepath.Join(s.dir, name, strconv.Itoa(k)+".m4s")
}

func (s *Session) initPath(name string) string { return filepath.Join(s.dir, name, "init.mp4") }

// needsRestart says whether waiting for segment k would be waiting in vain.
// It is asked only while k isn't ready: a run that has finished, or that
// started after k, won't bring it, nor (for video) one already past it.
func (s *Session) needsRestart(k int, video bool) bool {
	r := s.run
	if r == nil {
		return true
	}
	p := s.progressOf(r)
	if r.done || k < r.start || (video && k <= p) {
		return true
	}
	return s.spec.Segments[k]-s.end(p) > restartGap
}

// explain logs why the encoder moves, for the server's logs.
func (s *Session) explain(name string, k int) {
	if r := s.run; r != nil {
		log.Printf("session %s: %s %d asked for; encoder started at %d, done %v, at %d", s.id[:8], name, k, r.start, r.done, s.progressOf(r))
	}
}

func (s *Session) stopLocked() {
	r := s.run
	if r == nil || r.done || r.cmd.Process == nil {
		return
	}
	r.killed = true
	_ = r.cmd.Process.Signal(syscall.SIGCONT)
	_ = r.cmd.Process.Kill()
}

func (s *Session) startLocked(k int) {
	if s.closed {
		return
	}
	if s.failures[k] >= maxFailures {
		return
	}
	if !s.prepared {
		s.pendingAt = k
		if !s.preparing {
			s.preparing = true
			go s.prepare()
		}
		return
	}
	s.stopLocked()
	args := s.spec.Args
	if s.fallback && len(s.spec.Fallback) > 0 {
		args = s.spec.Fallback
	}
	start := s.spec.Segments[k]
	if k > 0 {
		start += s.spec.SeekPad
	}
	filled := s.fill(args, start)
	cmd := exec.Command(ffmpegPath, filled...)
	cmd.Dir = s.dir
	r := &run{cmd: cmd, start: k, progress: map[string]int{}, tails: map[string]*pendingSegment{}, stderr: &tail{}}
	cmd.Stderr = r.stderr
	readers := make([]*os.File, len(s.spec.Outputs))
	for i := range s.spec.Outputs {
		pr, pw, err := os.Pipe()
		if err != nil {
			s.problem = err.Error()
			return
		}
		readers[i] = pr
		cmd.ExtraFiles = append(cmd.ExtraFiles, pw)
	}
	if err := cmd.Start(); err != nil {
		s.problem = err.Error()
		for _, f := range append(readers, cmd.ExtraFiles...) {
			f.Close()
		}
		return
	}
	for _, f := range cmd.ExtraFiles {
		f.Close()
	}
	s.run = r
	log.Printf("session %s: encoding from segment %d (%.1fs)%s", s.id[:8], k, start, map[bool]string{true: " in software", false: ""}[s.fallback])
	for i, o := range s.spec.Outputs {
		r.readers.Add(1)
		go s.read(r, o, readers[i])
	}
	go s.wait(r)
	s.notify()
}

func (s *Session) fill(args []string, start float64) []string {
	out := make([]string, len(args))
	replacer := strings.NewReplacer("{input}", localInput(s.spec.Input), "{start}", strconv.FormatFloat(start, 'f', 3, 64), "{dir}", s.dir)
	for i, a := range args {
		out[i] = replacer.Replace(a)
	}
	return out
}

func (s *Session) prepare() {
	for _, step := range s.spec.Prepare {
		cmd := exec.Command(ffmpegPath, s.fill(step, 0)...)
		cmd.Dir = s.dir
		errs := &tail{}
		cmd.Stderr = errs
		if err := cmd.Run(); err != nil {
			log.Printf("session %s: preparing failed: %v %s", s.id[:8], err, errs.String())
		}
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prepared, s.preparing = true, false
	s.startLocked(s.pendingAt)
}

func (s *Session) read(r *run, o Output, f *os.File) {
	defer r.readers.Done()
	defer f.Close()
	if o.Kind == "vtt" {
		_ = readCues(f, func(c cue) {
			s.mu.Lock()
			s.cues[o.Name] = addCue(s.cues[o.Name], c)
			s.mu.Unlock()
		})
		return
	}
	current, last := -1, -1
	var data, lastData []byte
	finish := func(k int, b []byte) {
		path := s.path(o.Name, k)
		tmp := path + ".part"
		if err := os.WriteFile(tmp, b, 0o600); err == nil {
			_ = os.Rename(tmp, path)
		}
		s.mu.Lock()
		s.ready[o.Name][k] = true
		r.progress[o.Name] = k
		r.produced = true
		s.coverLocked(r)
		s.notify()
		s.mu.Unlock()
		last, lastData = k, b
	}
	/* A keyframe in the file's index that ffmpeg didn't cut at leaves a
	   fragment across a planned boundary: the segments it covers get the
	   same media, which players simply append again. */
	fillTo := func(k int) {
		if last >= 0 && k > last+1 {
			log.Printf("session %s: %s segments %d to %d share segment %d's media", s.id[:8], o.Name, last+1, k-1, last)
			for j := last + 1; j < k; j++ {
				finish(j, lastData)
			}
		}
	}
	err := splitFragments(f, func(init []byte) {
		path := s.initPath(o.Name)
		s.mu.Lock()
		have := s.inits[o.Name]
		s.mu.Unlock()
		if !have {
			tmp := path + ".part"
			if os.WriteFile(tmp, init, 0o600) == nil && os.Rename(tmp, path) == nil {
				s.mu.Lock()
				s.inits[o.Name] = true
				s.notify()
				s.mu.Unlock()
			}
		}
	}, func(fr fragment) {
		k := s.index(fr.time)
		if k < r.start {
			/* Seeking landed on an earlier keyframe: keep what reaches into the first segment. */
			if fr.end <= s.spec.Segments[r.start]+0.05 {
				return
			}
			k = r.start
		}
		if current >= 0 && k != current {
			finish(current, data)
			data = nil
		}
		if current != k {
			fillTo(k)
		}
		current = k
		data = append(data, fr.data...)
		/* The segment's last fragment: no need to wait for the next one to know. */
		if fr.end > 0 && fr.end >= s.end(k)-0.05 {
			finish(k, data)
			current, data = -1, nil
		}
	})
	s.mu.Lock()
	killed := r.killed
	s.mu.Unlock()
	if err != nil && !killed {
		log.Printf("session %s: %s: %v", s.id[:8], o.Name, err)
	}
	if current >= 0 {
		s.mu.Lock()
		r.tails[o.Name] = &pendingSegment{index: current, data: data}
		s.mu.Unlock()
	}
}

// coverLocked marks the subtitles complete for segments the video has passed.
func (s *Session) coverLocked(r *run) {
	p := s.progressOf(r)
	last := p - 1
	if r.done && r.ok {
		last = len(s.spec.Segments) - 1
	}
	for k := r.start; k <= last; k++ {
		s.covered[k] = true
	}
}

func (s *Session) wait(r *run) {
	err := r.cmd.Wait()
	r.readers.Wait()
	s.mu.Lock()
	defer s.mu.Unlock()
	r.done = true
	r.ok = err == nil && !r.killed
	if r.ok {
		for name, t := range r.tails {
			path := s.path(name, t.index)
			if os.WriteFile(path+".part", t.data, 0o600) == nil && os.Rename(path+".part", path) == nil {
				s.ready[name][t.index] = true
				r.progress[name] = t.index
			}
		}
		r.produced = true
		s.coverLocked(r)
	} else if !r.killed {
		log.Printf("session %s: ffmpeg stopped: %v: %s", s.id[:8], err, r.stderr.String())
		s.problem = "the encoder stopped: " + lastLine(r.stderr.String())
		if !r.produced && !s.fallback && len(s.spec.Fallback) > 0 && s.run == r {
			s.fallback = true
			s.startLocked(r.start)
		} else if !r.produced {
			s.failures[r.start]++
		}
	}
	s.notify()
}

// waitLocked waits for a change, giving up at the deadline or when the asker leaves.
func (s *Session) waitLocked(ctx context.Context, deadline time.Time) bool {
	ch := s.changed
	s.mu.Unlock()
	defer s.mu.Lock()
	left := time.Until(deadline)
	if left <= 0 {
		return false
	}
	timer := time.NewTimer(left)
	defer timer.Stop()
	select {
	case <-ch:
		return true
	case <-timer.C:
		return false
	case <-ctx.Done():
		return false
	}
}

func (s *Session) resumeLocked() {
	if r := s.run; r != nil && r.paused && !r.done {
		_ = r.cmd.Process.Signal(syscall.SIGCONT)
		r.paused = false
	}
}

// Init returns the init segment's path for a video output.
func (s *Session) Init(ctx context.Context, name string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastAccess = time.Now()
	deadline := time.Now().Add(waitFor)
	for {
		if s.inits[name] {
			return s.initPath(name), nil
		}
		if s.run == nil || (s.run.done && !s.run.produced) {
			at := s.lastReq
			if s.run != nil && s.failures[at] >= maxFailures {
				return "", fmt.Errorf("%s", s.problem)
			}
			s.startLocked(at)
		}
		if !s.waitLocked(ctx, deadline) {
			return "", fmt.Errorf("the encoder hasn't started: %s", s.problem)
		}
	}
}

// Segment returns a video segment's path, moving the encoder there if needed.
func (s *Session) Segment(ctx context.Context, name string, k int) (string, error) {
	if k < 0 || k >= len(s.spec.Segments) {
		return "", errGone
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastAccess = time.Now()
	s.lastReq = k
	s.seq++
	mine := s.seq
	deadline := time.Now().Add(waitFor)
	for {
		if s.ready[name][k] {
			return s.path(name, k), nil
		}
		if mine == s.seq && s.needsRestart(k, true) {
			if s.failures[k] >= maxFailures {
				return "", fmt.Errorf("%s", s.problem)
			}
			s.explain(name, k)
			s.startLocked(k)
		}
		s.resumeLocked()
		if !s.waitLocked(ctx, deadline) {
			return "", fmt.Errorf("segment %d isn't ready: %s", k, s.problem)
		}
	}
}

// Subtitles returns a subtitle segment's WebVTT.
func (s *Session) Subtitles(ctx context.Context, name string, k int) ([]byte, error) {
	if k < 0 || k >= len(s.spec.Segments) {
		return nil, errGone
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastAccess = time.Now()
	s.seq++
	mine := s.seq
	deadline := time.Now().Add(waitFor)
	for {
		if s.covered[k] {
			return vttSegment(s.cues[name], s.spec.Segments[k], s.end(k)), nil
		}
		if r := s.run; r != nil && k < r.start && !r.done {
			/* Behind where the encoder started: the video there was asked for before, so nothing is missed. */
			return vttSegment(nil, 0, 0), nil
		}
		if mine == s.seq && s.needsRestart(k, false) {
			if s.failures[k] >= maxFailures {
				return nil, fmt.Errorf("%s", s.problem)
			}
			s.lastReq = k
			s.explain(name, k)
			s.startLocked(k)
		}
		s.resumeLocked()
		if !s.waitLocked(ctx, deadline) {
			return nil, fmt.Errorf("subtitles for %d aren't ready", k)
		}
	}
}

func (s *Session) tick() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		if s.closed {
			s.mu.Unlock()
			return
		}
		if time.Since(s.lastAccess) > idleAfter {
			s.mu.Unlock()
			sessions.remove(s.id)
			return
		}
		if r := s.run; r != nil && !r.done {
			ahead := s.end(s.progressOf(r)) - s.spec.Segments[s.lastReq]
			if !r.paused && ahead > s.spec.Ahead {
				if r.cmd.Process.Signal(syscall.SIGSTOP) == nil {
					r.paused = true
				}
			} else if r.paused && ahead < s.spec.Ahead-15 {
				s.resumeLocked()
			}
		}
		for _, o := range s.spec.Outputs {
			if o.Kind != "fmp4" {
				continue
			}
			for k := range s.ready[o.Name] {
				if k < s.lastReq-keepBehind {
					_ = os.Remove(s.path(o.Name, k))
					delete(s.ready[o.Name], k)
				}
			}
		}
		s.mu.Unlock()
	}
}

func (s *Session) Close() {
	s.mu.Lock()
	s.closed = true
	s.stopLocked()
	s.notify()
	s.mu.Unlock()
	_ = os.RemoveAll(s.dir)
}

// The sessions running now.
type registry struct {
	mu   sync.Mutex
	all  map[string]*Session
	root string
}

var sessions = &registry{all: map[string]*Session{}}

func (g *registry) get(id string) *Session {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.all[id]
}

func (g *registry) put(id string, spec Spec) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.all[id]; ok {
		return nil
	}
	s, err := newSession(id, spec, g.root)
	if err != nil {
		return err
	}
	g.all[id] = s
	log.Printf("session %s: opened, %d segments, %d outputs", id[:8], len(spec.Segments), len(spec.Outputs))
	return nil
}

func (g *registry) remove(id string) {
	g.mu.Lock()
	s := g.all[id]
	delete(g.all, id)
	g.mu.Unlock()
	if s != nil {
		s.Close()
		log.Printf("session %s: closed", id[:8])
	}
}

// tail keeps the last few kilobytes of ffmpeg's complaints.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, p...)
	if len(t.buf) > 4096 {
		t.buf = t.buf[len(t.buf)-4096:]
	}
	return len(p), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return string(t.buf)
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}
