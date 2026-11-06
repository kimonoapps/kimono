package sandbox

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

/*
 * Screenshots and previews (docs/kimono-code.md, "Screenshots and previews").
 *
 * Inside a sandbox the agent's helpers write to /outbox: pictures under
 * /outbox/shots, and /outbox/serve.json while kimono-serve has an app up. The
 * node reads that while a turn runs and turns it into stream lines, and its
 * preview proxy answers for each live preview's name by Host. DNS never
 * changes per preview: one wildcard record covers every name.
 */

// preview is one workspace's published app: the command kimono-serve runs
// under its supervisor, where it runs, and what kind of app it is.
type preview struct {
	Name string   `json:"name"`
	Port int      `json:"port"`
	Args []string `json:"args,omitempty"`
	Kind string   `json:"kind,omitempty"`
	Dir  string   `json:"dir,omitempty"`
	// Stopped is the owner stopping the app but keeping its link: the proxy
	// says it isn't running instead of waking it, until it starts again.
	Stopped bool `json:"stopped,omitempty"`
}

var (
	previewNamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$`)
	shotNamePattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.(png|jpg|jpeg|webp)$`)
	previewWord        = regexp.MustCompile(`[a-z0-9]+`)
)

func validShotName(name string) bool {
	return shotNamePattern.MatchString(name) && !strings.Contains(name, "..")
}

// previewName is a few words of the branch and six random hex digits:
// readable in a link, and not guessable from the branch alone.
func previewName(branch string) string {
	tail := strings.ToLower(branch[strings.LastIndex(branch, "/")+1:])
	words := previewWord.FindAllString(tail, -1)
	// Kimono's branches end in a short hex suffix of their own; it says nothing.
	if n := len(words); n > 1 && len(words[n-1]) <= 6 && isHex(words[n-1]) {
		words = words[:n-1]
	}
	if len(words) > 3 {
		words = words[:3]
	}
	stem := strings.Join(words, "-")
	if len(stem) > 30 {
		stem = strings.TrimRight(stem[:30], "-")
	}
	suffix := make([]byte, 3)
	if _, err := rand.Read(suffix); err != nil {
		panic(err)
	}
	if stem == "" {
		stem = "preview"
	}
	return stem + "-" + hex.EncodeToString(suffix)
}

func isHex(value string) bool {
	_, err := hex.DecodeString(value + strings.Repeat("0", len(value)%2))
	return err == nil
}

// previewLabel picks the preview name out of a request's Host: the first label
// under the preview domain, or under localhost in development.
func previewLabel(host, domain string) (string, bool) {
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	var label string
	switch {
	case domain != "" && strings.HasSuffix(host, "."+domain):
		label = strings.TrimSuffix(host, "."+domain)
	case strings.HasSuffix(host, ".localhost"):
		label = strings.TrimSuffix(host, ".localhost")
	default:
		return "", false
	}
	if strings.Contains(label, ".") || !previewNamePattern.MatchString(label) {
		return "", false
	}
	return label, true
}

// previewURL is how people open a preview.
func (s *Server) previewURL(p *preview) string {
	if s.cfg.PreviewDomain != "" {
		return "https://" + p.Name + "." + s.cfg.PreviewDomain
	}
	_, port, _ := net.SplitHostPort(s.cfg.PreviewListen)
	return "http://" + p.Name + ".localhost:" + port
}

func (s *Server) previewJSON(id string) any {
	s.mu.Lock()
	p := s.previews[id]
	s.mu.Unlock()
	if p == nil {
		return nil
	}
	return s.previewBody(p)
}

// previewBody is a preview as the API and the stream describe it; the caller
// holds s.mu or owns p.
func (s *Server) previewBody(p *preview) map[string]any {
	return map[string]any{"url": s.previewURL(p), "port": p.Port, "kind": p.Kind, "stopped": p.Stopped}
}

func (s *Server) hasPreview(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.previews[id] != nil
}

/* ── the previews, kept across restarts ── */

func (s *Server) previewsPath() string { return filepath.Join(s.cfg.StateDir, "previews.json") }

func (s *Server) loadPreviews() {
	data, err := os.ReadFile(s.previewsPath())
	if err != nil {
		return
	}
	found := map[string]*preview{}
	if err := json.Unmarshal(data, &found); err != nil {
		s.cfg.Logf("previews: %v", err)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, p := range found {
		if validID(id) && p != nil && previewNamePattern.MatchString(p.Name) && p.Port > 0 && p.Port < 65536 {
			s.previews[id] = p
		}
	}
}

// savePreviews writes the table; the caller holds s.mu.
func (s *Server) savePreviews() {
	if err := os.MkdirAll(s.cfg.StateDir, 0700); err != nil {
		s.cfg.Logf("previews: %v", err)
		return
	}
	data, _ := json.MarshalIndent(s.previews, "", "  ")
	temporary := s.previewsPath() + ".tmp"
	if err := os.WriteFile(temporary, data, 0600); err == nil {
		err = os.Rename(temporary, s.previewsPath())
		if err != nil {
			s.cfg.Logf("previews: %v", err)
		}
	}
}

// setPreview records the app kimono-serve published, keeping its name if it
// had one. It reports whether the person should hear of it: a new link, a new
// kind of app, or one stopped before that runs again.
func (s *Server) setPreview(id string, serve serveState, branch string) (*preview, bool) {
	kind := appKind(serve.Command, serve.Kind)
	dir := serve.Cwd
	if !filepath.IsAbs(dir) || strings.ContainsRune(dir, 0) {
		dir = "/workspace"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.previews[id]
	if p != nil && p.Port == serve.Port && equalArgs(p.Args, serve.Command) && p.Kind == kind && p.Dir == dir && !p.Stopped {
		return p, false
	}
	if p == nil {
		p = &preview{Name: previewName(branch)}
		s.previews[id] = p
	}
	changed := p.Port != serve.Port || p.Kind != kind || p.Stopped
	p.Port, p.Args, p.Kind, p.Dir, p.Stopped = serve.Port, serve.Command, kind, dir, false
	s.savePreviews()
	return p, changed
}

// setStopped marks an app stopped by its owner, or started again.
func (s *Server) setStopped(id string, stopped bool) *preview {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.previews[id]
	if p != nil && p.Stopped != stopped {
		p.Stopped = stopped
		s.savePreviews()
	}
	return p
}

func (s *Server) isStopped(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.previews[id] != nil && s.previews[id].Stopped
}

// appKind is what the person is told they got: the agent's own words when it
// gave some (kimono-serve --kind), or a guess from the command.
func appKind(command []string, told string) string {
	if told = strings.Join(strings.Fields(told), " "); told != "" {
		// Kept short, and cut between words.
		if runes := []rune(told); len(runes) > 60 {
			told = string(runes[:60])
			if cut := strings.LastIndex(told, " "); cut > 0 {
				told = told[:cut]
			}
		}
		return told
	}
	words := map[string]bool{}
	for _, arg := range command {
		for _, word := range strings.Fields(strings.ToLower(arg)) {
			words[filepath.Base(word)] = true
		}
	}
	for _, guess := range []struct{ word, kind string }{
		{"http.server", "Static site"}, {"next", "Next.js app"}, {"vite", "Vite app"}, {"astro", "Astro site"}, {"nuxt", "Nuxt app"},
		{"uvicorn", "Python server"}, {"gunicorn", "Python server"}, {"flask", "Python server"}, {"streamlit", "Streamlit app"}, {"manage.py", "Django app"},
		{"python3", "Python server"}, {"python", "Python server"},
		{"node", "Node server"}, {"npm", "Node server"}, {"npx", "Node server"}, {"pnpm", "Node server"}, {"yarn", "Node server"}, {"bun", "Node server"}, {"tsx", "Node server"}, {"deno", "Deno server"},
		{"go", "Go server"},
	} {
		if words[guess.word] {
			return guess.kind
		}
	}
	return "Web app"
}

func (s *Server) clearPreview(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.previews[id] == nil {
		return false
	}
	delete(s.previews, id)
	s.savePreviews()
	return true
}

func equalArgs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

/* ── reading the outbox ── */

type outbox struct {
	shots []string
	// access are the agent's requests for some of the person's Drive (kimono-access), by file name.
	access []accessRequest
	// memories are what the agent asked to keep about the person (kimono-remember).
	memories []memoryNote
	serve    *serveState
	// restarting is kimono-serve replacing the app: the link stays as it is.
	restarting bool
}

type serveState struct {
	Port    int      `json:"port"`
	Pid     int      `json:"pid"`
	Command []string `json:"command"`
	Kind    string   `json:"kind"`
	Cwd     string   `json:"cwd"`
}

const outboxScript = `cd /outbox 2>/dev/null || exit 0
for f in shots/*; do [ -f "$f" ] && echo "shot ${f#shots/}"; done
for f in memories/*.json; do [ -f "$f" ] && printf 'memory %s ' "${f#memories/}" && head -c 2000 "$f" | tr -d '\n' && echo; done
for f in access/*.json; do [ -f "$f" ] && printf 'access %s ' "${f#access/}" && head -c 4000 "$f" | tr -d '\n' && echo; done
if [ -f serve.json ]; then printf 'serve '; tr -d '\n' < serve.json; echo; fi
[ -f .serve-restarting ] && echo restarting
exit 0`

func parseOutbox(out []byte) outbox {
	var box outbox
	for _, line := range strings.Split(string(out), "\n") {
		kind, rest, _ := strings.Cut(strings.TrimSpace(line), " ")
		switch kind {
		case "shot":
			if validShotName(rest) {
				box.shots = append(box.shots, rest)
			}
		case "restarting":
			box.restarting = true
		case "memory":
			name, body, _ := strings.Cut(rest, " ")
			if note, ok := parseRemembered(name, body); ok {
				box.memories = append(box.memories, note)
			}
		case "access":
			name, body, _ := strings.Cut(rest, " ")
			if request, ok := parseAccess(name, body); ok {
				box.access = append(box.access, request)
			}
		case "serve":
			var state serveState
			if json.Unmarshal([]byte(rest), &state) == nil && state.Port > 0 && state.Port < 65536 {
				box.serve = &state
			}
		}
	}
	sort.Strings(box.shots)
	return box
}

func (s *Server) readOutbox(ctx context.Context, id string) (outbox, error) {
	out, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "sh", "-c", outboxScript)
	if err != nil {
		return outbox{}, err
	}
	return parseOutbox(out), nil
}

// watchOutbox reports what the agent shows while a turn runs: every second,
// and once more when stop is closed. It returns when that last look is done.
func (s *Server) watchOutbox(space *workspace, out *lineWriter, stop <-chan struct{}) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.reportOutbox(space, out)
		case <-stop:
			s.reportOutbox(space, out)
			return
		}
	}
}

// primeOutbox remembers the pictures already there, so a turn reports only its own.
func (s *Server) primeOutbox(space *workspace) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	box, err := s.readOutbox(ctx, space.id)
	if err != nil {
		return
	}
	space.mu.Lock()
	if space.seenShots == nil {
		space.seenShots = map[string]bool{}
	}
	for _, name := range box.shots {
		space.seenShots[name] = true
	}
	space.mu.Unlock()
}

func (s *Server) reportOutbox(space *workspace, out *lineWriter) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	box, err := s.readOutbox(ctx, space.id)
	if err != nil {
		return
	}
	space.mu.Lock()
	if space.seenShots == nil {
		space.seenShots = map[string]bool{}
	}
	var fresh []string
	for _, name := range box.shots {
		if !space.seenShots[name] {
			space.seenShots[name] = true
			fresh = append(fresh, name)
		}
	}
	branch := space.repo.Branch
	space.mu.Unlock()
	for _, note := range box.memories {
		if _, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(space.id), "rm", "-f", "/outbox/memories/"+note.ID); err != nil {
			continue
		}
		line := map[string]any{"type": "kimono.memory", "text": note.Text}
		if note.Change != "" {
			line["change"] = note.Change
		}
		if note.Forget != "" {
			line["forget"] = note.Forget
		}
		out.json(line)
	}
	for _, request := range box.access {
		/* Taken out of the outbox once reported, so it is asked once. */
		if _, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(space.id), "rm", "-f", "/outbox/access/"+request.ID); err != nil {
			continue
		}
		out.json(map[string]any{"type": "kimono.access", "id": strings.TrimSuffix(request.ID, ".json"), "space": request.Space, "path": request.Path, "need": request.Need, "why": request.Why})
	}
	for _, name := range fresh {
		line := map[string]any{"type": "kimono.image", "name": name}
		if caption := s.caption(ctx, space.id, name); caption != "" {
			line["caption"] = caption
		}
		out.json(line)
	}
	switch {
	case box.restarting:
	case box.serve != nil:
		if p, changed := s.setPreview(space.id, *box.serve, branch); changed {
			out.json(map[string]any{"type": "kimono.preview", "url": s.previewURL(p), "port": p.Port, "kind": p.Kind})
		}
	case s.isStopped(space.id):
		// Its owner stopped it and kept the link.
	case s.clearPreview(space.id):
		out.json(map[string]any{"type": "kimono.preview.stopped"})
	}
}

// caption is what kimono-shot was told the picture shows, if anything.
func (s *Server) caption(ctx context.Context, id, name string) string {
	stem := strings.TrimSuffix(name, filepath.Ext(name))
	out, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "head", "-c", "500", "/outbox/shots/"+stem+".txt")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

/* ── the API ── */

func (s *Server) handleOutbox(w http.ResponseWriter, r *http.Request, id string) error {
	name := r.PathValue("name")
	if !validShotName(name) {
		return problem(400, "That picture name isn't one Kimono can use.")
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}
	const limit = 10 << 20
	out, err := s.docker.run(r.Context(), nil, "exec", "-u", "agent", containerName(id), "head", "-c", strconv.Itoa(limit+1), "/outbox/shots/"+name)
	if err != nil {
		return problem(404, "That picture isn't in this workspace.")
	}
	if len(out) > limit {
		return problem(413, "That picture is too large.")
	}
	types := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
	w.Header().Set("Content-Type", types[strings.ToLower(filepath.Ext(name))])
	w.Header().Set("Content-Length", strconv.Itoa(len(out)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(out)
	return nil
}

// previewCopy is a workspace's preview as it is now, safe to read unlocked.
func (s *Server) previewCopy(id string) *preview {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.previews[id]
	if p == nil {
		return nil
	}
	c := *p
	c.Args = append([]string(nil), p.Args...)
	return &c
}

// appHealth is how a published app is doing, as the supervisor reports it.
type appHealth struct {
	// State is running, starting, crashed (it keeps exiting and the supervisor
	// keeps starting it), stopped (by its owner), asleep (opening the link
	// wakes it) or down.
	State    string `json:"state"`
	Restarts int    `json:"restarts"`
	Exit     *int   `json:"exit,omitempty"`
	Since    int64  `json:"since,omitempty"`
}

const healthScript = `cat /outbox/serve-status.json 2>/dev/null; echo
(exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && echo up
exit 0`

func parseHealth(out []byte) appHealth {
	status, rest, _ := strings.Cut(string(out), "\n")
	var health appHealth
	var supervised struct {
		State    string `json:"state"`
		Restarts int    `json:"restarts"`
		Since    int64  `json:"since"`
		Exit     *int   `json:"exit"`
	}
	known := json.Unmarshal([]byte(status), &supervised) == nil && supervised.State != ""
	health.Restarts, health.Since, health.Exit = supervised.Restarts, supervised.Since, supervised.Exit
	switch {
	case strings.TrimSpace(rest) == "up":
		health.State = "running"
	case known && supervised.State == "restarting":
		health.State = "crashed"
	case known:
		health.State = "starting"
	default:
		health.State = "down"
	}
	return health
}

// health looks without waking anything: a sleeping sandbox's link still
// works, because opening it wakes the app.
func (s *Server) health(ctx context.Context, id string, p *preview) appHealth {
	if p.Stopped {
		return appHealth{State: "stopped"}
	}
	containerState, err := s.docker.containerState(ctx, id)
	switch {
	case err != nil || containerState == "" && s.sleepState(ctx, id, "") == "gone":
		return appHealth{State: "down"}
	case containerState != "running":
		return appHealth{State: "asleep"}
	}
	out, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "bash", "-c", healthScript, "health", strconv.Itoa(p.Port))
	if err != nil {
		return appHealth{State: "down"}
	}
	return parseHealth(out)
}

func (s *Server) handlePreview(w http.ResponseWriter, r *http.Request, id string) error {
	p := s.previewCopy(id)
	if p == nil {
		return problem(404, "This workspace has no preview.")
	}
	body := s.previewBody(p)
	body["health"] = s.health(r.Context(), id, p)
	body["disk"] = s.diskJSON(id)
	writeJSON(w, 200, body)
	return nil
}

// handlePreviewLogs is the end of what the app printed, kept across restarts.
func (s *Server) handlePreviewLogs(w http.ResponseWriter, r *http.Request, id string) error {
	if s.previewCopy(id) == nil {
		return problem(404, "This workspace has no preview.")
	}
	var out []byte
	if state, err := s.docker.containerState(r.Context(), id); err == nil && state == "running" {
		out, _ = s.docker.run(r.Context(), nil, "exec", "-u", "agent", containerName(id), "sh", "-c", "tail -n 400 /outbox/serve.log 2>/dev/null | tail -c 65536")
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(out)
	return nil
}

// handleRestartPreview starts the app again as it was published, even when it
// is running, and keeps its link.
func (s *Server) handleRestartPreview(w http.ResponseWriter, r *http.Request, id string) error {
	p := s.previewCopy(id)
	if p == nil {
		return problem(404, "This workspace has no app to start.")
	}
	if len(p.Args) == 0 {
		return problem(409, "Kimono doesn't know how to start this app. Ask the agent to run it.")
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}
	lock := s.serveLock(id)
	lock.Lock()
	err := s.startServe(r.Context(), id, p)
	lock.Unlock()
	if err != nil {
		s.cfg.Logf("restart app for %s: %v", id, err)
		return problem(502, "The app didn't start. Its log says why.")
	}
	s.setStopped(id, false)
	s.mu.Lock()
	body := s.previewBody(s.previews[id])
	s.mu.Unlock()
	writeJSON(w, 200, body)
	return nil
}

// handlePausePreview stops the app but keeps its link and how to start it.
func (s *Server) handlePausePreview(w http.ResponseWriter, r *http.Request, id string) error {
	if s.previewCopy(id) == nil {
		return problem(404, "This workspace has no app running.")
	}
	// Marked first, so a turn watching the outbox doesn't take the link down.
	p := s.setStopped(id, true)
	if state, err := s.docker.containerState(r.Context(), id); err == nil && state != "" && state != "exited" && state != "created" {
		if _, err := s.running(r.Context(), id); err != nil {
			return err
		}
		if _, err := s.docker.run(r.Context(), nil, "exec", "-u", "agent", containerName(id), "kimono-unserve", "--quiet"); err != nil {
			return err
		}
	}
	s.mu.Lock()
	body := s.previewBody(p)
	s.mu.Unlock()
	writeJSON(w, 200, body)
	return nil
}

// reservedPreviewNames are names no app may take: they read as the domain's own.
var reservedPreviewNames = map[string]bool{"www": true, "mail": true, "api": true, "admin": true, "kimono": true, "auth": true, "login": true}

// renamePreview gives a workspace's app the name its owner chose. Names are
// unique across the node; the old link stops answering at once.
func (s *Server) renamePreview(id, name string) (*preview, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	if !previewNamePattern.MatchString(name) || strings.Contains(name, "--") {
		return nil, problem(400, "Use letters, numbers and single dashes, up to 50 characters.")
	}
	if reservedPreviewNames[name] {
		return nil, problem(409, "That name is kept for the domain itself. Choose another.")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.previews[id]
	if p == nil {
		return nil, problem(404, "This workspace has no app running to name.")
	}
	for other, q := range s.previews {
		if other != id && q.Name == name {
			return nil, problem(409, "Another app already has that name.")
		}
	}
	p.Name = name
	s.savePreviews()
	return p, nil
}

func (s *Server) handleRenamePreview(w http.ResponseWriter, r *http.Request, id string) error {
	var request struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, 4<<10, &request); err != nil {
		return err
	}
	p, err := s.renamePreview(id, request.Name)
	if err != nil {
		return err
	}
	s.mu.Lock()
	body := s.previewBody(p)
	s.mu.Unlock()
	writeJSON(w, 200, body)
	return nil
}

func (s *Server) handleStopPreview(w http.ResponseWriter, r *http.Request, id string) error {
	if containerState, err := s.docker.containerState(r.Context(), id); err == nil && containerState != "" {
		if _, err := s.running(r.Context(), id); err == nil {
			_, _ = s.docker.run(r.Context(), nil, "exec", "-u", "agent", containerName(id), "kimono-unserve", "--quiet")
		}
	}
	s.clearPreview(id)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s *Server) portAnswers(ctx context.Context, id string, port int) bool {
	check := fmt.Sprintf("exec 3<>/dev/tcp/127.0.0.1/%d", port)
	_, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "bash", "-c", check)
	return err == nil
}

// reviveServe starts a preview's app again after its sandbox stopped or was
// made again, in the background.
func (s *Server) reviveServe(id string) {
	if !s.hasPreview(id) {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		if err := s.restartServe(ctx, id); err != nil {
			s.cfg.Logf("restart preview for %s: %v", id, err)
		}
	}()
}

// restartServe runs a preview's app again unless it already answers, its
// owner stopped it, or its supervisor is still running it (starting up, or
// starting it again after a crash: a second one would only interrupt it). A
// stopped container keeps kimono-serve's notes but not the process, so the
// port and the process decide, not the notes.
func (s *Server) restartServe(ctx context.Context, id string) error {
	p := s.previewCopy(id)
	if p == nil || p.Stopped || len(p.Args) == 0 || s.portAnswers(ctx, id, p.Port) {
		return nil
	}
	lock := s.serveLock(id)
	lock.Lock()
	defer lock.Unlock()
	if s.portAnswers(ctx, id, p.Port) {
		return nil
	}
	if alive, _ := s.supervisor(ctx, id); alive {
		return nil
	}
	return s.startServe(ctx, id, p)
}

const supervisorScript = `pgrep -u agent -f "[/]usr/local/lib/kimono/supervise" >/dev/null && echo alive || echo gone
jq -r .state /outbox/serve-status.json 2>/dev/null || true`

// supervisor says whether the app's supervisor is running in the sandbox, and
// what it last said it was doing (running, restarting).
func (s *Server) supervisor(ctx context.Context, id string) (alive bool, state string) {
	out, err := s.docker.run(ctx, nil, "exec", "-u", "agent", containerName(id), "bash", "-c", supervisorScript)
	if err != nil {
		return false, ""
	}
	first, rest, _ := strings.Cut(string(out), "\n")
	return strings.TrimSpace(first) == "alive", strings.TrimSpace(rest)
}

// recovering is what the proxy does when a request to a running sandbox's app
// fails: if the app isn't answering and can be started, it's brought back (in
// the background, shared with any wake under way) and true says to show the
// waking page. An app that answers failed on its own; one that keeps crashing
// would only crash again; neither is started.
func (s *Server) recovering(id string, port int) bool {
	p := s.previewCopy(id)
	if id == "" || p == nil || p.Stopped || len(p.Args) == 0 {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if s.portAnswers(ctx, id, port) {
		return false
	}
	if alive, state := s.supervisor(ctx, id); alive && state == "restarting" {
		return false
	}
	s.wakeForPreview(id, port)
	return true
}

// startServe runs kimono-serve as the agent did: same folder, command and kind.
// The caller holds serveLock.
func (s *Server) startServe(ctx context.Context, id string, p *preview) error {
	dir := p.Dir
	if dir == "" {
		dir = "/workspace"
	}
	command := []string{"exec", "-u", "agent", "-w", dir, containerName(id), "kimono-serve", strconv.Itoa(p.Port)}
	if p.Kind != "" {
		command = append(command, "--kind", p.Kind)
	}
	command = append(append(command, "--"), p.Args...)
	_, err := s.docker.run(ctx, nil, command...)
	return err
}

func (s *Server) serveLock(id string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := "serve:" + id
	lock := s.wakeLocks[key]
	if lock == nil {
		lock = &sync.Mutex{}
		s.wakeLocks[key] = lock
	}
	return lock
}

/* ── the proxy ── */

const notRunningPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not running</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#faf7f1;color:#24221f;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="max-width:28em;padding:24px"><h1 style="font-weight:600;font-size:22px;margin:0 0 8px">This preview isn't running</h1>
<p style="margin:0;color:#5b524d">It may have been stopped, or the link is wrong.</p></div>`

type targetKey struct{}
type target struct {
	id   string
	port int
}

// PreviewHandler answers for every live preview by name.
func (s *Server) PreviewHandler() http.Handler {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			t, _ := ctx.Value(targetKey{}).(target)
			if s.dial != nil {
				return s.dial(ctx, t.id, t.port)
			}
			return s.dialSandbox(ctx, t.id, t.port)
		},
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       60 * time.Second,
		ResponseHeaderTimeout: 2 * time.Minute,
	}
	proxy := &httputil.ReverseProxy{
		Transport: transport,
		// Streams (server-sent events, streamed rendering) reach the browser as written.
		FlushInterval: -1,
		Rewrite: func(r *httputil.ProxyRequest) {
			t, _ := r.In.Context().Value(targetKey{}).(target)
			// One pool per sandbox and port: the address is only a key; the dial picks the sandbox.
			r.Out.URL.Scheme = "http"
			r.Out.URL.Host = t.id + ".sandbox:" + strconv.Itoa(t.port)
			// Dev servers refuse Host names they don't know; to them this is localhost.
			r.Out.Host = "localhost:" + strconv.Itoa(t.port)
			r.SetXForwarded()
			r.Out.Header.Set("X-Forwarded-Host", r.In.Host)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			s.cfg.Logf("preview %s: %v", r.Host, err)
			t, _ := r.Context().Value(targetKey{}).(target)
			// The sandbox is up but its app isn't answering: start it again
			// and say it's waking, rather than a dead end until someone presses Restart.
			if s.recovering(t.id, t.port) {
				stillWaking(w)
				return
			}
			notRunning(w, http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		label, ok := previewLabel(r.Host, s.cfg.PreviewDomain)
		var id string
		var port int
		var stopped bool
		if ok {
			s.mu.Lock()
			for workspaceID, p := range s.previews {
				if p.Name == label {
					id, port, stopped = workspaceID, p.Port, p.Stopped
					break
				}
			}
			s.mu.Unlock()
		}
		if id == "" {
			notRunning(w, http.StatusNotFound)
			return
		}
		if stopped {
			notRunning(w, http.StatusServiceUnavailable)
			return
		}
		s.touch(id)
		state, err := s.docker.containerState(r.Context(), id)
		if err != nil {
			notRunning(w, http.StatusBadGateway)
			return
		}
		s.mu.Lock()
		underway := s.wakings[id] != nil
		s.mu.Unlock()
		if underway {
			// The container may already be up while its app is still starting.
			state = "waking"
		}
		switch state {
		case "running":
		case "paused":
			// Frozen in memory: thawing is instant, so nobody waits.
			if _, err := s.wake(r.Context(), id); err != nil {
				notRunning(w, http.StatusBadGateway)
				return
			}
		default:
			// Stopped or removed: start it and its app, and if that takes more
			// than a moment, say so instead of leaving the browser spinning.
			patience := 1500 * time.Millisecond
			if isUpgrade(r.Header.Get("Connection")) {
				patience = 20 * time.Second
			}
			wk := s.wakeForPreview(id, port)
			select {
			case <-wk.done:
				if wk.err != nil {
					s.cfg.Logf("wake %s for its preview: %v", id, wk.err)
					var refused *apiProblem
					if errors.As(wk.err, &refused) && refused.status == http.StatusTooManyRequests {
						serverFull(w)
						return
					}
					notRunning(w, http.StatusBadGateway)
					return
				}
			case <-time.After(patience):
				stillWaking(w)
				return
			case <-r.Context().Done():
				return
			}
		}
		w.Header().Set("X-Robots-Tag", "noindex")
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), targetKey{}, target{id: id, port: port})))
	})
}

func stillWaking(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Retry-After", "2")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, wakingPage)
}

const serverFullPage = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Busy</title>
<body style="font:16px/1.5 system-ui,sans-serif;background:#faf7f1;color:#24221f;display:grid;place-items:center;min-height:90vh;margin:0">
<div style="max-width:28em;padding:24px"><h1 style="font-weight:600;font-size:22px;margin:0 0 8px">This app is asleep, and the server is busy</h1>
<p style="margin:0;color:#5b524d">Every slot is taken by work in progress. Try again in a few minutes.</p></div>`

// serverFull is a sleeping app that can't wake: the awake caps are full of working sandboxes.
func serverFull(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Retry-After", "60")
	w.WriteHeader(http.StatusServiceUnavailable)
	_, _ = io.WriteString(w, serverFullPage)
}

func notRunning(w http.ResponseWriter, status int) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, notRunningPage)
}

// dialSandbox reaches a port inside a sandbox: straight to its address on the
// sandbox network when the app listens there, otherwise (an app bound to
// localhost, or Docker in a VM as on macOS) through the container itself.
func (s *Server) dialSandbox(ctx context.Context, id string, port int) (net.Conn, error) {
	if !dockerDesktop {
		if ip := s.containerIP(ctx, id); ip != "" {
			dialer := net.Dialer{Timeout: 2 * time.Second}
			if conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip, strconv.Itoa(port))); err == nil {
				return conn, nil
			}
		}
	}
	return s.execDial(id, port)
}

func (s *Server) containerIP(ctx context.Context, id string) string {
	out, err := s.docker.run(ctx, nil, "container", "inspect", "-f", fmt.Sprintf(`{{(index .NetworkSettings.Networks %q).IPAddress}}`, s.cfg.Network), containerName(id))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// execDial is a connection carried by socat inside the container.
func (s *Server) execDial(id string, port int) (net.Conn, error) {
	cmd := exec.Command(s.cfg.Docker, "exec", "-i", "-u", "agent", containerName(id), "socat", "-", "TCP:127.0.0.1:"+strconv.Itoa(port))
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &pipeConn{cmd: cmd, in: stdin, out: stdout}, nil
}

type pipeConn struct {
	cmd  *exec.Cmd
	in   io.WriteCloser
	out  io.ReadCloser
	once sync.Once
}

func (c *pipeConn) Read(b []byte) (int, error)  { return c.out.Read(b) }
func (c *pipeConn) Write(b []byte) (int, error) { return c.in.Write(b) }
func (c *pipeConn) Close() error {
	c.once.Do(func() {
		_ = c.in.Close()
		if c.cmd.Process != nil {
			_ = c.cmd.Process.Kill()
		}
		_ = c.cmd.Wait()
	})
	return nil
}
func (c *pipeConn) LocalAddr() net.Addr              { return pipeAddr{} }
func (c *pipeConn) RemoteAddr() net.Addr             { return pipeAddr{} }
func (c *pipeConn) SetDeadline(time.Time) error      { return nil }
func (c *pipeConn) SetReadDeadline(time.Time) error  { return nil }
func (c *pipeConn) SetWriteDeadline(time.Time) error { return nil }

type pipeAddr struct{}

func (pipeAddr) Network() string { return "docker-exec" }
func (pipeAddr) String() string  { return "sandbox" }

/* ── asking for the person's files ── */

// accessRequest is what kimono-access wrote: some of the person's Drive, and why.
type accessRequest struct {
	ID    string `json:"-"`
	Space string `json:"space"`
	Path  string `json:"path"`
	Need  string `json:"need"`
	Why   string `json:"why"`
}

var accessNamePattern = regexp.MustCompile(`^[0-9]{1,16}-[0-9a-f]{8}\.json$`)

func parseAccess(name, body string) (accessRequest, bool) {
	var request accessRequest
	if !accessNamePattern.MatchString(name) || json.Unmarshal([]byte(body), &request) != nil {
		return request, false
	}
	request.ID = name
	request.Space, request.Path, request.Why = strings.TrimSpace(request.Space), strings.Trim(strings.TrimSpace(request.Path), "/"), strings.TrimSpace(request.Why)
	if request.Space == "" || len(request.Space) > 120 || len(request.Path) > 1000 || request.Why == "" || len(request.Why) > 300 {
		return request, false
	}
	if request.Need != "read" && request.Need != "change" {
		return request, false
	}
	return request, true
}

// memoryNote is one thing kimono-remember was asked to keep, change (an
// existing memory's id and its new text) or forget (an id alone).
type memoryNote struct {
	ID     string `json:"-"`
	Text   string `json:"text"`
	Change string `json:"change"`
	Forget string `json:"forget"`
}

var memoryIDPattern = regexp.MustCompile(`^[0-9a-f]{8,32}$`)

func parseRemembered(name, body string) (memoryNote, bool) {
	var note memoryNote
	if !accessNamePattern.MatchString(name) || json.Unmarshal([]byte(body), &note) != nil {
		return note, false
	}
	note.ID, note.Text = name, strings.TrimSpace(note.Text)
	if note.Forget != "" {
		return note, memoryIDPattern.MatchString(note.Forget) && note.Change == ""
	}
	if note.Change != "" && !memoryIDPattern.MatchString(note.Change) {
		return note, false
	}
	return note, note.Text != "" && len(note.Text) <= 500
}
