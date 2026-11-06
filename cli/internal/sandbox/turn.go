package sandbox

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"path"
	"strings"
	"sync"
	"time"
)

type turnRequest struct {
	Prompt      string   `json:"prompt"`
	Session     string   `json:"session"`
	Attachments []string `json:"attachments"`
	// Effort is how hard the agent thinks: low, medium, high, xhigh or max; empty is Claude Code's default.
	Effort string `json:"effort"`
	// Model is which Claude runs the turn: opus, sonnet or haiku; empty is opus. Portal chooses.
	Model string `json:"model"`
	// Context is the person's own: their instructions and what Kimono remembers
	// about them. It joins the system prompt for this turn.
	Context string `json:"context"`
	// ResumeAt rewinds the session first: it carries on from this assistant
	// message (its uuid), and what came after is dropped. A person edited an
	// earlier message, and this turn runs it again from there.
	ResumeAt string `json:"resumeAt"`
}

const maxContext = 24 * 1024

// Models are the Claudes a turn may run on, by the short name Portal sends.
var Models = map[string]string{"": Model, "opus": Model, "sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}

var efforts = map[string]bool{"": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}

// turnWrapper records the agent's process group so cancel can stop all of it:
// setsid makes the shell a group leader, and eval keeps the agent in it.
const turnWrapper = `echo $$ > /tmp/kimono-turn.pid; eval "$KIMONO_AGENT"`

const cancelScript = `p=$(cat /tmp/kimono-turn.pid 2>/dev/null) || exit 0
kill -TERM "-$p" 2>/dev/null || exit 0
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "-$p" 2>/dev/null || exit 0; sleep 0.5; done
kill -KILL "-$p" 2>/dev/null || true`

func (s *Server) handleTurn(w http.ResponseWriter, r *http.Request, id string) error {
	var request turnRequest
	if err := readJSON(r, 1<<20, &request); err != nil {
		return err
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return problem(400, "Say what the agent should do.")
	}
	if _, ok := Models[request.Model]; !ok {
		return problem(400, "Model is opus, sonnet or haiku.")
	}
	if len(request.Context) > maxContext {
		return problem(400, "The person's instructions and memories are too long.")
	}
	if !efforts[request.Effort] {
		return problem(400, "Effort is low, medium, high, xhigh or max.")
	}
	if request.ResumeAt != "" && (request.Session == "" || !namePattern.MatchString(request.ResumeAt)) {
		return problem(400, "A turn resumes at a message of its session.")
	}
	if request.Session != "" && !namePattern.MatchString(request.Session) {
		return problem(400, "That session isn't one Kimono can resume.")
	}
	prompt, err := withAttachments(request.Prompt, request.Attachments)
	if err != nil {
		return err
	}
	space, err := s.remembered(id)
	if err != nil {
		return err
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}

	space.mu.Lock()
	if space.busy {
		space.mu.Unlock()
		return problem(409, "The agent is already working in this workspace.")
	}
	var stopOnce sync.Once
	cancelled := false
	stop := func() {
		stopOnce.Do(func() {
			space.mu.Lock()
			cancelled = true
			space.mu.Unlock()
			// The container keeps running the agent if only the docker CLI dies.
			stopping, done := context.WithTimeout(context.Background(), 15*time.Second)
			defer done()
			_, _ = s.docker.run(stopping, nil, "exec", "-u", "agent", containerName(id), "sh", "-c", cancelScript)
		})
	}
	space.busy, space.cancel, space.lastActive = true, func() { go stop() }, time.Now()
	space.mu.Unlock()
	defer func() {
		space.mu.Lock()
		space.busy, space.cancel, space.lastActive = false, nil, time.Now()
		space.mu.Unlock()
	}()

	s.primeOutbox(space)
	// What it has to work with, and whether it must make room first.
	limits := s.limitsNow()
	system := s.cfg.SystemPrompt + "\n\n" + limitsPrompt(limits)
	space.mu.Lock()
	chat := space.repo.URL == ""
	space.mu.Unlock()
	if request.Context != "" {
		system += "\n\n" + request.Context
	}
	if chat {
		system += "\n\nThis is a chat, not a project: there is no repository to commit to, push or open a pull request for. /workspace is this chat's own scratch space, and it is kept in the person's Drive."
	}
	used, measuredAt := s.diskUse(id)
	if s.now().Sub(measuredAt) > time.Minute {
		if fresh, err := s.measureDisk(r.Context(), id); err == nil {
			used = fresh
		}
	}
	full := diskNote(used, limits)
	if full != "" {
		system += "\n\n" + full
	}
	extra := []string{"KIMONO_PROMPT=" + prompt, "KIMONO_SESSION=" + request.Session, "KIMONO_AGENT=" + s.cfg.Agent, "KIMONO_SYSTEM=" + system, "KIMONO_EFFORT=" + request.Effort, "KIMONO_MODEL=" + Models[request.Model], "KIMONO_RESUME_AT=" + request.ResumeAt}
	args := s.execArgs(space, extra, false, "setsid", "-w", "sh", "-c", turnWrapper)
	cmd := exec.Command(s.cfg.Docker, args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	// The Portal going away ends the turn; nothing else would read it.
	finished := make(chan struct{})
	defer close(finished)
	go func() {
		select {
		case <-r.Context().Done():
			stop()
		case <-finished:
		}
	}()

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	out := &lineWriter{w: w}
	out.json(map[string]any{"type": "kimono.started", "at": time.Now().UnixMilli()})
	if full != "" {
		out.json(map[string]any{"type": "kimono.disk", "used": used, "quota": limits.diskQuota()})
	}
	// Writing past the ceiling stops the turn: nothing else stops a full disk.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-finished:
				return
			case <-ticker.C:
				check, done := context.WithTimeout(context.Background(), 20*time.Second)
				used, err := s.measureDisk(check, id)
				done()
				if err == nil && used > limits.diskCeiling() {
					out.json(map[string]any{"type": "kimono.disk.full", "used": used, "quota": limits.diskQuota()})
					stop()
					return
				}
			}
		}
	}()

	var wait sync.WaitGroup
	wait.Add(1)
	go func() {
		defer wait.Done()
		forwardStderr(stderr, out)
	}()
	// Pictures and previews are reported as they appear, and once more at the end.
	stopWatching := make(chan struct{})
	watched := make(chan struct{})
	go func() {
		defer close(watched)
		s.watchOutbox(space, out, stopWatching)
	}()
	session := request.Session
	reader := bufio.NewReaderSize(stdout, 64<<10)
	for {
		line, readErr := reader.ReadBytes('\n')
		if trimmed := strings.TrimSpace(string(line)); trimmed != "" {
			if json.Valid([]byte(trimmed)) && strings.HasPrefix(trimmed, "{") {
				var meta struct {
					SessionID string `json:"session_id"`
				}
				if json.Unmarshal([]byte(trimmed), &meta) == nil && meta.SessionID != "" {
					session = meta.SessionID
				}
				out.raw(trimmed)
			} else {
				out.json(map[string]any{"type": "kimono.stderr", "text": truncate(trimmed, 2000)})
			}
		}
		if readErr != nil {
			break
		}
		space.touch()
	}
	wait.Wait()
	close(stopWatching)
	<-watched
	exit := 0
	if err := cmd.Wait(); err != nil {
		var failure *exec.ExitError
		if errors.As(err, &failure) {
			exit = failure.ExitCode()
		} else {
			exit = -1
		}
	}
	space.mu.Lock()
	wasCancelled := cancelled
	space.mu.Unlock()
	/* What this turn used of the plan's windows, before the turn is called done. */
	credit, fiveHour, week := s.usage.take(id)
	out.json(usageLine(credit, fiveHour, week))
	done := map[string]any{"type": "kimono.done", "session": session, "exit": exit, "at": time.Now().UnixMilli()}
	if wasCancelled {
		done["cancelled"] = true
	}
	out.json(done)
	return nil
}

func (s *Server) handleCancel(w http.ResponseWriter, r *http.Request, id string) error {
	s.mu.Lock()
	space := s.spaces[id]
	s.mu.Unlock()
	if space != nil {
		space.mu.Lock()
		cancel := space.cancel
		space.mu.Unlock()
		if cancel != nil {
			cancel()
		}
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// withAttachments names the uploaded files in the prompt, after checking they
// are ones the attachments call could have made.
func withAttachments(prompt string, attachments []string) (string, error) {
	if len(attachments) == 0 {
		return prompt, nil
	}
	if len(attachments) > 20 {
		return "", problem(400, "Attach at most 20 files to one message.")
	}
	for _, attachment := range attachments {
		if path.Dir(attachment) != "/attachments" || !validAttachmentName(path.Base(attachment)) {
			return "", problem(400, "That attachment isn't one this workspace has.")
		}
	}
	return prompt + "\n\nAttached files: " + strings.Join(attachments, ", "), nil
}

// forwardStderr passes the agent's stderr on, but at most 200 lines a turn.
func forwardStderr(stderr io.Reader, out *lineWriter) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 64<<10), 1<<20)
	sent := 0
	for scanner.Scan() {
		text := strings.TrimSpace(scanner.Text())
		if text == "" {
			continue
		}
		if sent++; sent > 200 {
			continue
		}
		out.json(map[string]any{"type": "kimono.stderr", "text": truncate(text, 2000)})
	}
}

func truncate(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	return text[:limit] + "…"
}

// lineWriter writes whole NDJSON lines from several goroutines, flushing each.
type lineWriter struct {
	mu sync.Mutex
	w  http.ResponseWriter
}

func (l *lineWriter) raw(line string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = io.WriteString(l.w, line+"\n")
	if flusher, ok := l.w.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (l *lineWriter) json(value any) {
	encoded, _ := json.Marshal(value)
	l.raw(string(encoded))
}
