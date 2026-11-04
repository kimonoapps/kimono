package sandbox

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
 * Sleep. An idle sandbox should cost next to nothing, and waking it should go
 * unnoticed. Activity is a running turn, any API call for the workspace, the
 * agent using the model or Kimono Git, or a request through its preview.
 *
 *   quiet for PauseAfter  (1 min)  → paused:  frozen in memory, resumes instantly
 *   quiet for StopAfter   (15 min) → stopped: memory freed, files kept
 *   quiet for RemoveAfter (7 days) → removed: container gone, files kept on its volume
 *
 * Anything that needs the sandbox wakes it: unpause, start, or make the
 * container again on the same volume. A preview's app is started again with it.
 * The last activity of every sandbox is kept in StateDir, so restarting the node
 * neither wakes everything nor forgets what was overdue.
 */

// record is what the node keeps about a sandbox across restarts: never a credential.
type record struct {
	Repo Repo      `json:"repo"`
	Last time.Time `json:"last"`
}

type sleepAction string

const (
	stayAwake sleepAction = ""
	pauseIt   sleepAction = "pause"
	stopIt    sleepAction = "stop"
	removeIt  sleepAction = "remove"
)

// decide is the whole policy, as a pure function of the container's state, whether
// a turn is running, and how long the sandbox has been quiet.
func decide(state string, busy bool, quiet time.Duration, cfg Config) sleepAction {
	if busy {
		return stayAwake
	}
	removable := cfg.RemoveAfter > 0 && quiet >= cfg.RemoveAfter
	switch state {
	case "running":
		switch {
		case removable:
			return removeIt
		case quiet >= cfg.StopAfter:
			return stopIt
		case quiet >= cfg.PauseAfter:
			return pauseIt
		}
	case "paused":
		switch {
		case removable:
			return removeIt
		case quiet >= cfg.StopAfter:
			return stopIt
		}
	case "exited", "created", "dead":
		if removable {
			return removeIt
		}
	}
	return stayAwake
}

/* ── records ── */

func (s *Server) recordsPath() string { return filepath.Join(s.cfg.StateDir, "sandboxes.json") }

func (s *Server) loadRecords() {
	data, err := os.ReadFile(s.recordsPath())
	if err != nil {
		return
	}
	found := map[string]*record{}
	if err := json.Unmarshal(data, &found); err != nil {
		s.cfg.Logf("sandboxes: %v", err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, r := range found {
		if validID(id) && r != nil {
			s.records[id] = r
		}
	}
}

// saveRecords writes the table; the caller holds s.mu.
func (s *Server) saveRecords() {
	if err := os.MkdirAll(s.cfg.StateDir, 0700); err != nil {
		s.cfg.Logf("sandboxes: %v", err)
		return
	}
	data, _ := json.MarshalIndent(s.records, "", "  ")
	temporary := s.recordsPath() + ".tmp"
	if err := os.WriteFile(temporary, data, 0600); err == nil {
		if err := os.Rename(temporary, s.recordsPath()); err != nil {
			s.cfg.Logf("sandboxes: %v", err)
		}
	}
	s.recordsSaved = s.now()
}

// remember keeps a sandbox's repository, so a removed container can be made again.
func (s *Server) remember(id string, repo Repo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.records[id]
	if r == nil {
		r = &record{}
		s.records[id] = r
	}
	r.Repo, r.Last = repo, s.now()
	s.saveRecords()
}

func (s *Server) forget(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.records[id] != nil {
		delete(s.records, id)
		s.saveRecords()
	}
}

// touch marks a workspace as in use now.
func (s *Server) touch(id string) {
	s.mu.Lock()
	w := s.spaces[id]
	r := s.records[id]
	if r == nil {
		// Known only to Docker so far (the node restarted): its repository
		// arrives with the next ensure, but its activity counts from now.
		r = &record{}
		s.records[id] = r
	}
	r.Last = s.now()
	// Kept on disk every few seconds at most, so status and a restart see it.
	if r.Last.Sub(s.recordsSaved) > 5*time.Second {
		s.saveRecords()
	}
	s.mu.Unlock()
	if w != nil {
		w.touch()
	}
}

// quietFor is how long a sandbox has gone without use: the latest of what this
// process saw and what was kept from before it; never longer than since the
// node started for one it knows nothing about.
func (s *Server) quietFor(id string, now time.Time) (time.Duration, bool) {
	s.mu.Lock()
	w := s.spaces[id]
	r := s.records[id]
	s.mu.Unlock()
	last := s.started
	if r != nil && !r.Last.IsZero() {
		last = r.Last
	}
	busy := false
	if w != nil {
		w.mu.Lock()
		if w.lastActive.After(last) {
			last = w.lastActive
		}
		busy = w.busy
		w.mu.Unlock()
	}
	return now.Sub(last), busy
}

// keepRepoLabel copies a container's repository into its record when the record
// doesn't have it yet (a sandbox this node never ensured).
func (s *Server) keepRepoLabel(ctx context.Context, id string) {
	s.mu.Lock()
	r := s.records[id]
	missing := r == nil || r.Repo.Owner == ""
	s.mu.Unlock()
	if !missing {
		return
	}
	owner, name, ok := strings.Cut(s.repoLabel(ctx, id), "/")
	if !ok || !namePattern.MatchString(owner) || !namePattern.MatchString(name) {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.records[id] == nil {
		s.records[id] = &record{Last: s.now()}
	}
	s.records[id].Repo.Owner, s.records[id].Repo.Name = owner, name
	s.saveRecords()
}

/* ── the sweep ── */

// sweep puts quiet sandboxes to sleep, a step deeper each time they stay quiet.
func (s *Server) sweep(ctx context.Context) {
	found, err := s.docker.sandboxes(ctx)
	if err != nil {
		s.cfg.Logf("sweep: %v", err)
		return
	}
	now := s.now()
	for id, state := range found {
		quiet, busy := s.quietFor(id, now)
		action := decide(state, busy, quiet, s.cfg)
		if action == stayAwake {
			continue
		}
		lock := s.wakeLock(id)
		lock.Lock()
		// Something may have used it while the lock was being taken.
		if quiet, busy = s.quietFor(id, s.now()); decide(state, busy, quiet, s.cfg) != action {
			lock.Unlock()
			continue
		}
		name := containerName(id)
		switch action {
		case pauseIt:
			_, err = s.docker.run(ctx, nil, "pause", name)
		case stopIt:
			if state == "paused" {
				_, _ = s.docker.run(ctx, nil, "unpause", name)
			}
			_, err = s.docker.run(ctx, nil, "stop", "-t", "5", name)
		case removeIt:
			// The named volume holds the work; only the container goes. Keep
			// which repository it was, so waking can make the container again.
			s.keepRepoLabel(ctx, id)
			_, err = s.docker.run(ctx, nil, "rm", "-f", name)
		}
		lock.Unlock()
		if err != nil {
			s.cfg.Logf("%s %s: %v", action, id, err)
		} else {
			s.cfg.Logf("%s %s after %s quiet", action, id, quiet.Round(time.Second))
		}
	}
	s.mu.Lock()
	if now.Sub(s.recordsSaved) > 30*time.Second {
		s.saveRecords()
	}
	s.mu.Unlock()
}

// sweepEvery is how often the sweep looks: often enough that a pause lands
// within a few seconds of being due.
func (s *Server) sweepEvery() time.Duration {
	every := s.cfg.PauseAfter / 6
	if every < time.Second {
		every = time.Second
	}
	if every > 10*time.Second {
		every = 10 * time.Second
	}
	return every
}

/* ── waking ── */

// wakeLock serialises waking and sleeping one sandbox, so the sweep never
// pauses a container a request is bringing back.
func (s *Server) wakeLock(id string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lock := s.wakeLocks[id]
	if lock == nil {
		lock = &sync.Mutex{}
		s.wakeLocks[id] = lock
	}
	return lock
}

func (s *Server) volumeExists(ctx context.Context, id string) bool {
	_, err := s.docker.run(ctx, nil, "volume", "inspect", containerName(id))
	return err == nil
}

// wake brings a sandbox's container back to running from whatever sleep it is
// in. It reports whether the container had stopped (so its apps need starting).
func (s *Server) wake(ctx context.Context, id string) (restarted bool, err error) {
	lock := s.wakeLock(id)
	lock.Lock()
	defer lock.Unlock()
	s.touch(id)
	state, err := s.docker.containerState(ctx, id)
	if err != nil {
		return false, err
	}
	name := containerName(id)
	switch state {
	case "running":
		return false, nil
	case "paused":
		_, err = s.docker.run(ctx, nil, "unpause", name)
		return false, err
	case "":
		s.mu.Lock()
		r := s.records[id]
		s.mu.Unlock()
		if r == nil || r.Repo.Owner == "" || !s.volumeExists(ctx, id) {
			return false, problem(404, "This workspace's sandbox is gone. Open it again to start a new one.")
		}
		// Removed while quiet: the same volume in a new container.
		return true, s.create(ctx, id, r.Repo)
	default:
		_, err = s.docker.run(ctx, nil, "start", name)
		return true, err
	}
}

// sleepState is what the API says about a sandbox's container.
func (s *Server) sleepState(ctx context.Context, id, state string) string {
	switch state {
	case "running":
		return "ready"
	case "paused":
		return "paused"
	case "":
		s.mu.Lock()
		known := s.records[id] != nil && s.records[id].Repo.Owner != ""
		s.mu.Unlock()
		if known && s.volumeExists(ctx, id) {
			return "stopped"
		}
		return "gone"
	default:
		return "stopped"
	}
}

/* ── the preview proxy's patience ── */

const wakingPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="2"><title>Waking up…</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#faf7f1;color:#24221f;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="max-width:28em;padding:24px"><h1 style="font-weight:600;font-size:22px;margin:0 0 8px">Waking up…</h1>
<p style="margin:0;color:#5b524d">This app was asleep. It will open by itself in a moment.</p></div>`

// waking is one sandbox being brought back for its preview, shared by every
// request that arrives meanwhile.
type waking struct {
	done chan struct{}
	err  error
}

// wakeForPreview starts bringing a sandbox and its app back, or joins the wake
// already under way, and returns a channel closed when the app answers.
func (s *Server) wakeForPreview(id string, port int) *waking {
	s.mu.Lock()
	if current := s.wakings[id]; current != nil {
		s.mu.Unlock()
		return current
	}
	wk := &waking{done: make(chan struct{})}
	s.wakings[id] = wk
	s.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		wk.err = s.bringBack(ctx, id, port)
		s.mu.Lock()
		delete(s.wakings, id)
		s.mu.Unlock()
		close(wk.done)
	}()
	return wk
}

// bringBack wakes the sandbox, starts its app if it had stopped, and waits for the port.
func (s *Server) bringBack(ctx context.Context, id string, port int) error {
	if _, err := s.wake(ctx, id); err != nil {
		return err
	}
	if s.portAnswers(ctx, id, port) {
		return nil
	}
	if err := s.restartServe(ctx, id); err != nil {
		return err
	}
	for {
		if s.portAnswers(ctx, id, port) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(300 * time.Millisecond):
		}
	}
}

func isUpgrade(headerValue string) bool {
	return strings.Contains(strings.ToLower(headerValue), "upgrade")
}

/* ── status, for `kimono node sandboxes status` ── */

// StatusRow is one sandbox as an operator sees it.
type StatusRow struct {
	ID    string
	Repo  string
	State string // ready, paused, stopped, gone
	Quiet time.Duration
}

// Status lists every sandbox the node knows about: containers, and removed
// ones whose files are still kept. It reads Docker and StateDir; no server needed.
func Status(ctx context.Context, dockerBin, stateDir string) ([]StatusRow, error) {
	s := &Server{cfg: Config{StateDir: stateDir, Logf: func(string, ...any) {}}, docker: docker{bin: dockerBin}, records: map[string]*record{}, now: time.Now}
	s.started = s.now()
	s.loadRecords()
	found, err := s.docker.sandboxes(ctx)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for id := range found {
		ids[id] = true
	}
	for id := range s.records {
		ids[id] = true
	}
	var rows []StatusRow
	for id := range ids {
		row := StatusRow{ID: id, State: s.sleepState(ctx, id, found[id])}
		if r := s.records[id]; r != nil {
			row.Repo = r.Repo.Owner + "/" + r.Repo.Name
			if !r.Last.IsZero() {
				row.Quiet = s.now().Sub(r.Last)
			}
		}
		rows = append(rows, row)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Quiet < rows[j].Quiet })
	return rows, nil
}
