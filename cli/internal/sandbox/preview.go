package sandbox

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
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

// preview is one workspace's published app.
type preview struct {
	Name string   `json:"name"`
	Port int      `json:"port"`
	Args []string `json:"args,omitempty"`
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
	return map[string]any{"url": s.previewURL(p), "port": p.Port}
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

// setPreview records a workspace's app on a port, keeping its name if it had one.
// It reports whether anything changed.
func (s *Server) setPreview(id string, port int, args []string, branch string) (*preview, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.previews[id]
	if p != nil && p.Port == port && equalArgs(p.Args, args) {
		return p, false
	}
	if p == nil {
		p = &preview{Name: previewName(branch)}
		s.previews[id] = p
	}
	changed := p.Port != port
	p.Port, p.Args = port, args
	s.savePreviews()
	return p, changed
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
	serve *serveState
	// restarting is kimono-serve replacing the app: the link stays as it is.
	restarting bool
}

type serveState struct {
	Port    int      `json:"port"`
	Pid     int      `json:"pid"`
	Command []string `json:"command"`
}

const outboxScript = `cd /outbox 2>/dev/null || exit 0
for f in shots/*; do [ -f "$f" ] && echo "shot ${f#shots/}"; done
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
		if p, changed := s.setPreview(space.id, box.serve.Port, box.serve.Command, branch); changed {
			out.json(map[string]any{"type": "kimono.preview", "url": s.previewURL(p), "port": p.Port})
		}
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

func (s *Server) handlePreview(w http.ResponseWriter, r *http.Request, id string) error {
	s.mu.Lock()
	p := s.previews[id]
	s.mu.Unlock()
	if p == nil {
		return problem(404, "This workspace has no preview.")
	}
	// Asking doesn't wake it. A sleeping sandbox's link still works: opening it wakes the app.
	state := "live"
	if containerState, err := s.docker.containerState(r.Context(), id); err != nil || containerState == "" && s.sleepState(r.Context(), id, "") == "gone" {
		state = "down"
	} else if containerState == "running" && !s.portAnswers(r.Context(), id, p.Port) {
		state = "down"
	}
	writeJSON(w, 200, map[string]any{"url": s.previewURL(p), "port": p.Port, "state": state})
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

// restartServe runs a preview's app again unless it already answers. A stopped
// container keeps kimono-serve's notes but not the process, so the port decides.
func (s *Server) restartServe(ctx context.Context, id string) error {
	s.mu.Lock()
	p := s.previews[id]
	var port int
	var args []string
	if p != nil {
		port, args = p.Port, append([]string(nil), p.Args...)
	}
	s.mu.Unlock()
	if p == nil || len(args) == 0 || s.portAnswers(ctx, id, port) {
		return nil
	}
	lock := s.serveLock(id)
	lock.Lock()
	defer lock.Unlock()
	if s.portAnswers(ctx, id, port) {
		return nil
	}
	command := append([]string{"exec", "-u", "agent", "-w", "/workspace", containerName(id), "kimono-serve", strconv.Itoa(port), "--"}, args...)
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
			return s.dialSandbox(ctx, t.id, t.port)
		},
		MaxIdleConnsPerHost:   8,
		IdleConnTimeout:       60 * time.Second,
		ResponseHeaderTimeout: 2 * time.Minute,
	}
	proxy := &httputil.ReverseProxy{
		Transport: transport,
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
			notRunning(w, http.StatusBadGateway)
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		label, ok := previewLabel(r.Host, s.cfg.PreviewDomain)
		var id string
		var port int
		if ok {
			s.mu.Lock()
			for workspaceID, p := range s.previews {
				if p.Name == label {
					id, port = workspaceID, p.Port
					break
				}
			}
			s.mu.Unlock()
		}
		if id == "" {
			notRunning(w, http.StatusNotFound)
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
