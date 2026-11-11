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
	// The segment the player starts in (where the viewer left off): the
	// encoder starts there before anything is asked for.
	Start int `json:"start,omitempty"`
	// The intro and recap: what follows each is made while the viewer is
	// in it, since most skip.
	Skips []Skip `json:"skips,omitempty"`
}

// Skip is a part the player offers to skip, in seconds.
type Skip struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

const (
	segmentTarget = 6.0 // seconds a segment runs at least (the Portal's plan)
	idleAfter     = 60 * time.Second
	waitFor       = 100 * time.Second
	restartGap    = 24.0 // seconds past the encoder's progress worth waiting for
	keepBehind    = 8    // segments always kept behind the latest request
	// Made segments are kept for the whole play, so seeking back is instant,
	// until a session's take this much disk; then those farthest from the
	// viewer go first.
	keepBytes = 4 << 30
	// How long a request that would move the encoder waits to see if a newer
	// one follows: dragging across the timeline asks for one spot after
	// another, and only where it stops is worth reading from the source.
	settleFor   = 400 * time.Millisecond
	maxFailures = 2
	// Seconds before where the encoder started that are made once it is well
	// ahead, so skipping back after a seek or a resume lands on made segments.
	fillBehind = 60.0
	// Filled in nearest first: the segment just before alone, then this much
	// at a time, so a skip back of ten seconds is ready soonest.
	fillChunk = 12.0
	// Seconds after an intro or recap made while the viewer is in it: the
	// picture plays from them while the encoder starts where they end.
	skipAhead = 15.0
	// Seconds before an intro or recap that already count as in it.
	skipLead = 5.0
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
	// How fast this run makes segments, to tell whether a request a little
	// past it is quicker waited for or started over at.
	began     time.Time
	firstAt   time.Duration // to the first finished segment
	firstEnd  float64       // where that segment ends
	pausedAt  time.Time
	pausedFor time.Duration
	// A run filling in behind the encoder's start stops once it reaches
	// this segment; 0 for the encoder itself.
	stop int
	// How far back the encoder's run has been filled in from (its start
	// until a fill-in begins).
	filledFrom int
	readers    sync.WaitGroup
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
	behind     *run // filling in before run's start (fillBehind) or after a skip (skipAhead)
	ready      map[string]map[int]bool
	sizes      map[string]map[int]int64
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
	// Video requests waiting now: subtitles leave moving the encoder to them.
	videoWaiting int
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
		ready: map[string]map[int]bool{}, sizes: map[string]map[int]int64{}, inits: map[string]bool{}, cues: map[string][]cue{},
		covered: map[int]bool{}, failures: map[int]int{}, lastAccess: time.Now(), prepared: len(spec.Prepare) == 0,
	}
	for _, o := range spec.Outputs {
		s.ready[o.Name] = map[int]bool{}
		s.sizes[o.Name] = map[int]int64{}
	}
	if spec.Start > 0 && spec.Start < len(spec.Segments) {
		s.lastReq = spec.Start
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
	if b := s.behind; b != nil && !b.done && k > s.progressOf(b) && k < b.stop {
		/* Being filled in now: waited for when that's sooner than starting over. */
		cost := 2 * time.Second
		if r != nil && r.firstAt > 0 {
			cost = r.firstAt
		}
		if wait, known := s.etaLocked(b, k); !known || wait <= cost+settleFor {
			return false
		}
	}
	if r == nil {
		return true
	}
	p := s.progressOf(r)
	if r.done || k < r.start || (video && k <= p) {
		return true
	}
	if s.spec.Segments[k]-s.end(p) > restartGap {
		return true
	}
	/* Within reach, but a high-bitrate film or a transcode can take longer to
	   read its way there than a new run takes to make its first segment. */
	wait, known := s.etaLocked(r, k)
	return known && wait > r.firstAt+settleFor
}

// etaLocked is how long run r will take to finish segment k at the pace it
// has kept since its first segment; known is false until there is a pace.
func (s *Session) etaLocked(r *run, k int) (time.Duration, bool) {
	p := s.progressOf(r)
	if r.firstAt == 0 || p < 0 {
		return 0, false
	}
	active := time.Since(r.began) - r.pausedFor - r.firstAt
	if r.paused {
		active -= time.Since(r.pausedAt)
	}
	made := s.end(p) - r.firstEnd
	/* A pace from a moment's work is noise (a burst, or a pause to share the source). */
	if made < 2*segmentTarget || active < 2*time.Second {
		return 0, false
	}
	pace := made / active.Seconds() // seconds of the film per second
	return time.Duration((s.end(k) - s.end(p)) / pace * float64(time.Second)), true
}

// explain logs why the encoder moves, for the server's logs.
func (s *Session) explain(name string, k int) {
	if r := s.run; r != nil {
		log.Printf("session %s: %s %d asked for; encoder started at %d, done %v, at %d", s.id[:8], name, k, r.start, r.done, s.progressOf(r))
	}
}

func (s *Session) stopLocked() {
	kill(s.run)
	kill(s.behind)
	s.behind = nil
}

func kill(r *run) {
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
	r := s.launchLocked(k, 0)
	if r == nil {
		return
	}
	s.run = r
	log.Printf("session %s: encoding from segment %d (%.1fs)%s", s.id[:8], k, s.spec.Segments[k], map[bool]string{true: " in software", false: ""}[s.fallback])
	s.notify()
}

// moveLocked brings the encoder to segment k. Just behind where it started
// (skipping back after a seek or a resume), a run fills in from k instead,
// so what it has made ahead stays and goes on.
func (s *Session) moveLocked(k int) {
	r := s.run
	if r == nil || r.done || k >= r.start || s.spec.Segments[r.start]-s.spec.Segments[k] > fillBehind || s.failures[k] > 0 || !s.prepared {
		s.startLocked(k)
		return
	}
	kill(s.behind)
	s.behind = nil
	stop := k + 1
	for stop < r.start && !s.madeLocked(stop) {
		stop++
	}
	if b := s.launchLocked(k, stop); b != nil {
		s.behind = b
		r.filledFrom = min(r.filledFrom, k)
		log.Printf("session %s: filling in segments %d to %d for a skip back", s.id[:8], k, stop-1)
		s.notify()
	}
}

// launchLocked starts ffmpeg at segment k, its outputs read into the
// session; stop > 0 for a run that only fills in up to that segment.
func (s *Session) launchLocked(k, stop int) *run {
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
	r := &run{cmd: cmd, start: k, stop: stop, filledFrom: k, progress: map[string]int{}, tails: map[string]*pendingSegment{}, stderr: &tail{}, began: time.Now()}
	cmd.Stderr = r.stderr
	readers := make([]*os.File, len(s.spec.Outputs))
	for i := range s.spec.Outputs {
		pr, pw, err := os.Pipe()
		if err != nil {
			s.problem = err.Error()
			return nil
		}
		readers[i] = pr
		cmd.ExtraFiles = append(cmd.ExtraFiles, pw)
	}
	if err := cmd.Start(); err != nil {
		s.problem = err.Error()
		for _, f := range append(readers, cmd.ExtraFiles...) {
			f.Close()
		}
		return nil
	}
	for _, f := range cmd.ExtraFiles {
		f.Close()
	}
	for i, o := range s.spec.Outputs {
		r.readers.Add(1)
		go s.read(r, o, readers[i])
	}
	go s.wait(r)
	return r
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
		s.mu.Lock()
		/* Filling in behind leaves what the encoder has made as it is. */
		keep := r.stop > 0 && s.ready[o.Name][k]
		past := r.stop > 0 && k >= r.stop
		s.mu.Unlock()
		if past {
			return
		}
		if !keep {
			path := s.path(o.Name, k)
			tmp := path + ".part"
			if err := os.WriteFile(tmp, b, 0o600); err == nil {
				_ = os.Rename(tmp, path)
			}
		}
		s.mu.Lock()
		if !keep {
			s.ready[o.Name][k] = true
			s.sizes[o.Name][k] = int64(len(b))
		}
		r.progress[o.Name] = k
		r.produced = true
		if r.firstAt == 0 {
			r.firstAt, r.firstEnd = time.Since(r.began), s.end(k)
		}
		s.coverLocked(r)
		if r.stop > 0 && s.progressOf(r) >= r.stop-1 {
			/* The subtitles up to here are read too: their cues come before the picture's next keyframe. */
			for j := r.start; j < r.stop; j++ {
				s.covered[j] = true
			}
			kill(r)
			log.Printf("session %s: filled in segments %d to %d", s.id[:8], r.start, r.stop-1)
		}
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
	if r.stop > 0 {
		if s.behind == r {
			s.behind = nil
		}
		/* One that made nothing: the next request there starts the encoder itself. */
		if !r.ok && !r.killed && !r.produced {
			s.failures[r.start]++
		}
		s.notify()
		return
	}
	if r.ok {
		for name, t := range r.tails {
			path := s.path(name, t.index)
			if os.WriteFile(path+".part", t.data, 0o600) == nil && os.Rename(path+".part", path) == nil {
				s.ready[name][t.index] = true
				s.sizes[name][t.index] = int64(len(t.data))
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
		r.pausedFor += time.Since(r.pausedAt)
	}
}

// running says whether an encoder is at work that moving would stop.
func (s *Session) running() bool { return s.run != nil && !s.run.done }

// settleLocked waits settleFor before a request stops a running encoder, to
// see whether the viewer is only passing through (dragging across the
// timeline); the caller then looks again. An error when the player gave up.
func (s *Session) settleLocked(ctx context.Context) error {
	s.mu.Unlock()
	defer s.mu.Lock()
	select {
	case <-time.After(settleFor):
	case <-ctx.Done():
	}
	return ctx.Err()
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
	s.videoWaiting++
	defer func() {
		/* Subtitles held back for this request look again. */
		if s.videoWaiting--; s.videoWaiting == 0 {
			s.notify()
		}
	}()
	deadline := time.Now().Add(waitFor)
	settled := false
	for {
		if s.ready[name][k] {
			if mine == s.seq {
				s.leapLocked(k)
			}
			return s.path(name, k), nil
		}
		if mine == s.seq && s.needsRestart(k, true) && !settled && s.running() {
			settled = true
			if err := s.settleLocked(ctx); err != nil {
				return "", err
			}
			continue
		}
		if mine == s.seq && s.needsRestart(k, true) {
			if s.failures[k] >= maxFailures {
				return "", fmt.Errorf("%s", s.problem)
			}
			s.explain(name, k)
			s.moveLocked(k)
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
	/* Not counted as newer than the video: after a seek players ask for the
	   subtitles a segment before the picture, and starting the encoder there
	   would make the picture wait for a whole segment more. */
	mine := s.seq
	deadline := time.Now().Add(waitFor)
	settled := false
	for {
		if s.covered[k] {
			return vttSegment(s.cues[name], s.spec.Segments[k], s.end(k)), nil
		}
		if b := s.behind; b != nil && !b.done && k >= b.start && k < b.stop {
			/* Being filled in: wait for it. */
		} else if r := s.run; r != nil && k < r.start && !r.done && s.videoWaiting == 0 {
			/* Behind where the encoder started: the video there was asked for before, so nothing is missed. */
			return vttSegment(nil, 0, 0), nil
		}
		/* Only when the encoder won't get here: one merely far ahead of the
		   picture would be dragged away from where the picture is wanted. */
		moves := mine == s.seq && s.videoWaiting == 0 && (s.run == nil || s.run.done) && s.needsRestart(k, false)
		if moves && !settled && s.running() {
			settled = true
			if err := s.settleLocked(ctx); err != nil {
				return nil, err
			}
			continue
		}
		if moves {
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
					r.paused, r.pausedAt = true, time.Now()
				}
			} else if r.paused && ahead < s.spec.Ahead-15 {
				s.resumeLocked()
			}
			/* Once the picture asked for is out: the source has room for both. */
			if r.firstAt > 0 && time.Since(r.began) > r.firstAt+time.Second {
				s.skipAheadLocked(r)
				s.fillBehindLocked(r)
			}
		}
		s.evictLocked()
		s.mu.Unlock()
	}
}

// fillBehindLocked makes the minute before where the encoder started, once
// it is well ahead of the viewer, nearest first: skipping back after a seek
// or a resume then lands on made segments instead of moving the encoder.
func (s *Session) fillBehindLocked(r *run) {
	if s.behind != nil || s.closed {
		return
	}
	for hi := r.filledFrom; hi > 0 && s.spec.Segments[r.start]-s.spec.Segments[hi] < fillBehind; hi = r.filledFrom {
		lo := hi - 1
		for lo > 0 && hi < r.start && s.spec.Segments[hi]-s.spec.Segments[lo] < fillChunk {
			lo--
		}
		r.filledFrom = lo
		for ; lo < hi && s.madeLocked(lo); lo++ {
		}
		if lo == hi {
			continue
		}
		if b := s.launchLocked(lo, hi); b != nil {
			s.behind = b
			log.Printf("session %s: filling in segments %d to %d", s.id[:8], lo, hi-1)
		}
		return
	}
}

// skipRange is the segments after skip sk that are made ahead of it.
func (s *Session) skipRange(sk Skip) (lo, stop int) {
	lo = s.index(sk.End)
	if lo < 0 || sk.End >= s.spec.Duration-1 {
		return 0, 0
	}
	stop = lo + 1
	for stop < len(s.spec.Segments) && s.spec.Segments[stop]-s.spec.Segments[lo] < skipAhead {
		stop++
	}
	return lo, stop
}

// skipAheadLocked makes the seconds after the intro or recap the viewer is
// in, unless the encoder will be there soon anyway: a skip then plays at once.
func (s *Session) skipAheadLocked(r *run) {
	if s.behind != nil || s.closed {
		return
	}
	at := s.spec.Segments[s.lastReq]
	for _, sk := range s.spec.Skips {
		if at < sk.Start-skipLead || at >= sk.End {
			continue
		}
		lo, stop := s.skipRange(sk)
		if stop <= lo || r.start > lo || sk.End-s.end(s.progressOf(r)) <= restartGap {
			continue
		}
		for ; lo < stop && s.madeLocked(lo); lo++ {
		}
		if lo == stop || s.failures[lo] > 0 {
			continue
		}
		if b := s.launchLocked(lo, stop); b != nil {
			s.behind = b
			log.Printf("session %s: making segments %d to %d ahead of a skip", s.id[:8], lo, stop-1)
		}
		return
	}
}

// leapLocked follows a skip that landed on segments made ahead of it: the
// encoder starts where they end, while they play.
func (s *Session) leapLocked(k int) {
	if s.behind != nil && !s.behind.done {
		return
	}
	for _, sk := range s.spec.Skips {
		lo, stop := s.skipRange(sk)
		if k < lo || k >= stop {
			continue
		}
		j := k
		for j < len(s.spec.Segments) && s.madeLocked(j) {
			j++
		}
		if j == len(s.spec.Segments) || s.failures[j] > 0 {
			return
		}
		if r := s.run; r != nil && !r.done && r.start <= j && s.spec.Segments[j]-s.end(s.progressOf(r)) <= restartGap {
			return
		}
		log.Printf("session %s: skipped to %d; encoding on from %d", s.id[:8], k, j)
		s.startLocked(j)
		return
	}
}

// madeLocked says whether every picture output has segment k.
func (s *Session) madeLocked(k int) bool {
	for _, o := range s.spec.Outputs {
		if o.Kind == "fmp4" && !s.ready[o.Name][k] {
			return false
		}
	}
	return true
}

// evictLocked deletes made segments once the session's take more than
// keepBytes: those farthest from the viewer first, never the few just behind
// them or any ahead.
func (s *Session) evictLocked() {
	type made struct {
		name string
		k    int
		size int64
	}
	var total int64
	var behind []made
	for name, sizes := range s.sizes {
		for k, size := range sizes {
			total += size
			if k < s.lastReq-keepBehind {
				behind = append(behind, made{name, k, size})
			}
		}
	}
	if total <= keepBytes {
		return
	}
	sort.Slice(behind, func(i, j int) bool { return behind[i].k < behind[j].k })
	for _, m := range behind {
		if total <= keepBytes {
			return
		}
		_ = os.Remove(s.path(m.name, m.k))
		delete(s.ready[m.name], m.k)
		delete(s.sizes[m.name], m.k)
		total -= m.size
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
