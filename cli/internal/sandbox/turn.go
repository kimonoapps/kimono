package sandbox

import (
	"archive/tar"
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os/exec"
	"path"
	"regexp"
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
	// NoThinking answers straight away, without thinking first: a quick message on Auto.
	NoThinking bool `json:"noThinking"`
	// Model is which Claude runs the turn: fable, opus, sonnet or haiku; empty is opus. Portal chooses.
	Model string `json:"model"`
	// Context is the person's own: their instructions and what Kimono remembers
	// about them. It joins the system prompt for this turn.
	Context string `json:"context"`
	// ResumeAt rewinds the session first: it carries on from this assistant
	// message (its uuid), and what came after is dropped. A person edited an
	// earlier message, and this turn runs it again from there.
	ResumeAt string `json:"resumeAt"`
	// Fork carries the session on in a new one, leaving it as it was: a
	// second take on the same message, beside the first (Portal's takes.ts).
	Fork bool `json:"fork"`
	// Links is where kimono-link's files can be fetched from the internet:
	// Portal's public address for this workspace's temporary file links.
	Links string `json:"links"`
	// LinkKey signs kimono-link's tokens, so Portal can turn away a made-up
	// link without waking this sandbox to look.
	LinkKey string `json:"linkKey"`
	// Skills are the ones the person turned on, by their folder under
	// /opt/kimono/skills: linked into ~/.claude/skills for the agent to load
	// when one fits. Always are skills that shape every reply: their words
	// join the system prompt instead.
	Skills []string `json:"skills"`
	Always []string `json:"always"`
	// Custom are skills people here wrote, among Skills and Always: each
	// one's SKILL.md, written to ~/.kimono/custom-skills/<id> before the turn.
	Custom []customSkill `json:"custom"`
}

type customSkill struct {
	ID   string `json:"id"`
	File string `json:"file"`
}

const maxCustomSkills, maxCustomSkill = 100, 32 * 1024

const maxContext = 24 * 1024

// Models are the Claudes a turn may run on, by the short name Portal sends.
var Models = map[string]string{"": Model, "fable": "claude-fable-5-2", "opus": Model, "sonnet": "claude-sonnet-5-5", "haiku": "claude-haiku-5-5"}

var efforts = map[string]bool{"": true, "low": true, "medium": true, "high": true, "xhigh": true, "max": true}

// turnWrapper records the agent's process group so cancel can stop all of it:
// setsid makes the shell a group leader, and eval keeps the agent in it.
const turnWrapper = `echo $$ > /tmp/kimono-turn.pid; eval "$KIMONO_AGENT"`

const cancelScript = `p=$(cat /tmp/kimono-turn.pid 2>/dev/null) || exit 0
kill -TERM "-$p" 2>/dev/null || exit 0
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "-$p" 2>/dev/null || exit 0; sleep 0.5; done
kill -KILL "-$p" 2>/dev/null || true`

func (s *Server) handleTurn(w http.ResponseWriter, r *http.Request, id string) error {
	received := time.Now()
	var request turnRequest
	if err := readJSON(r, 1<<20, &request); err != nil {
		return err
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return problem(400, "Say what the agent should do.")
	}
	if _, ok := Models[request.Model]; !ok {
		return problem(400, "Model is fable, opus, sonnet or haiku.")
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
	if request.Fork && request.Session == "" {
		return problem(400, "Only a session can be carried on in a new one.")
	}
	if request.Session != "" && !namePattern.MatchString(request.Session) {
		return problem(400, "That session isn't one Kimono can resume.")
	}
	for _, skill := range append(append([]string{}, request.Skills...), request.Always...) {
		if !skillPattern.MatchString(skill) {
			return problem(400, "That isn't a skill Kimono has.")
		}
	}
	if len(request.Custom) > maxCustomSkills {
		return problem(400, "That's more skills than a turn can take.")
	}
	for _, skill := range request.Custom {
		if !skillPattern.MatchString(skill.ID) || len(skill.File) > maxCustomSkill {
			return problem(400, "That isn't a skill Kimono can use.")
		}
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
	// A session that isn't here any more would start the agent with nothing
	// of the chat: say so, and the Portal tells a new one what was said.
	if request.Session != "" && !s.hasSession(r.Context(), space, request.Session) {
		return problem(410, "This chat's session isn't in its sandbox any more.")
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
	if err := s.writeCustomSkills(r.Context(), space, request.Custom); err != nil {
		return err
	}
	// What it has to work with, and whether it must make room first.
	limits := s.limitsNow()
	space.mu.Lock()
	chat := space.repo.URL == ""
	fastSearch := space.tools.URL != ""
	space.mu.Unlock()
	system := s.cfg.SystemPrompt + "\n\n" + limitsPrompt(limits, chat)
	if request.Context != "" {
		system += "\n\n" + request.Context
	}
	if chat {
		system += "\n\nThis is a chat, not a project: there is no repository to commit to, push or open a pull request for, and no app to publish (kimono-serve is for projects only, so don't use it or any other way to put a server up). To show something, make an artifact; to hand over a file, kimono-send it; to give a tool a file by link, kimono-link it. /workspace is this chat's own scratch space, and it is kept in the person's Drive."
	} else {
		system += "\n\n" + AppPrompt
	}
	if fastSearch {
		system += "\n\n" + SearchPrompt
	}
	// The last count will do for the prompt: counting a big workspace again would hold up the
	// first word, and the check below counts it afresh as soon as the agent is under way.
	used, _ := s.diskUse(id)
	full := diskNote(used, limits)
	if full != "" {
		system += "\n\n" + full
	}
	extra := []string{"KIMONO_PROMPT=" + prompt, "KIMONO_SESSION=" + request.Session, "KIMONO_AGENT=" + s.cfg.Agent, "KIMONO_SYSTEM=" + system, "KIMONO_EFFORT=" + request.Effort, "KIMONO_MODEL=" + Models[request.Model], "KIMONO_RESUME_AT=" + request.ResumeAt, "KIMONO_FORK=" + chatFlag(request.Fork), "KIMONO_LINKS=" + linksBase(request.Links), "KIMONO_LINK_KEY=" + linkKey(request.LinkKey), "KIMONO_CHAT=" + chatFlag(chat), "KIMONO_SETTINGS=" + SteerSettings, "KIMONO_SKILLS=" + strings.Join(request.Skills, " "), "KIMONO_ALWAYS=" + strings.Join(request.Always, " "),
		// Every tool is there from the start, so a web search is one step, not a lookup and then the search.
		"ENABLE_TOOL_SEARCH=false"}
	if request.NoThinking {
		extra = append(extra, "CLAUDE_CODE_DISABLE_THINKING=1")
	}
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
	s.cfg.Logf("turn %s: agent started %dms after the request", id, time.Since(received).Milliseconds())
	if full != "" {
		out.json(map[string]any{"type": "kimono.disk", "used": used, "quota": limits.diskQuota()})
	}
	// Writing past the ceiling stops the turn: nothing else stops a full disk. The
	// first count is straight away, the rest every 30 seconds.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		first := make(chan struct{}, 1)
		first <- struct{}{}
		for {
			select {
			case <-finished:
				return
			case <-first:
			case <-ticker.C:
			}
			check, done := context.WithTimeout(context.Background(), 20*time.Second)
			used, err := s.measureDisk(check, id)
			done()
			if err == nil && used > limits.diskCeiling() {
				out.json(map[string]any{"type": "kimono.disk.full", "used": used, "quota": limits.diskQuota()})
				stop()
				return
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
// are ones the attachments call could have made, or (a file over 20 MB, which
// stays a Drive file) one at the top of the repository, where Drive put it.
func withAttachments(prompt string, attachments []string) (string, error) {
	if len(attachments) == 0 {
		return prompt, nil
	}
	if len(attachments) > 20 {
		return "", problem(400, "Attach at most 20 files to one message.")
	}
	for _, attachment := range attachments {
		inRepo := false
		if rest, ok := strings.CutPrefix(attachment, "/workspace/"); ok {
			clean, fine := cleanPath(rest)
			inRepo = fine && rest != "" && clean == rest && !strings.Contains(rest, "/") && !strings.HasPrefix(rest, ".")
		}
		if !inRepo && (path.Dir(attachment) != "/attachments" || !validAttachmentName(path.Base(attachment))) {
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

// linksBase is Portal's base for temporary file links, or "" when it isn't a
// plain http(s) address (kimono-link then says it can't make one).
func linksBase(raw string) string {
	if (!strings.HasPrefix(raw, "https://") && !strings.HasPrefix(raw, "http://")) || strings.ContainsAny(raw, " \t\n\r\"'`$\\") || len(raw) > 512 {
		return ""
	}
	return strings.TrimRight(raw, "/")
}

var linkKeyPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

func linkKey(raw string) string {
	if !linkKeyPattern.MatchString(raw) {
		return ""
	}
	return raw
}

func chatFlag(chat bool) string {
	if chat {
		return "1"
	}
	return ""
}

// hasSession is whether the agent's session [session] is in the sandbox to resume.
func (s *Server) hasSession(ctx context.Context, w *workspace, session string) bool {
	_, err := s.exec(ctx, w, nil, nil, "sh", "-c", `ls "$HOME"/.claude/projects/*/"$1".jsonl >/dev/null 2>&1`, "has-session", session)
	return err == nil
}

// skillPattern is a skill's folder name under /opt/kimono/skills.
var skillPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// writeCustomSkills replaces ~/.kimono/custom-skills with the skills people
// here wrote that this turn uses, one folder each, for the agent to link in
// beside the image's own. A turn with none leaves the folder as it was: the
// agent only links what the turn names.
func (s *Server) writeCustomSkills(ctx context.Context, w *workspace, custom []customSkill) error {
	if len(custom) == 0 {
		return nil
	}
	var archive bytes.Buffer
	tw := tar.NewWriter(&archive)
	for _, skill := range custom {
		if err := tw.WriteHeader(&tar.Header{Name: skill.ID + "/", Typeflag: tar.TypeDir, Mode: 0o755}); err != nil {
			return err
		}
		if err := tw.WriteHeader(&tar.Header{Name: skill.ID + "/SKILL.md", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(skill.File))}); err != nil {
			return err
		}
		if _, err := tw.Write([]byte(skill.File)); err != nil {
			return err
		}
	}
	if err := tw.Close(); err != nil {
		return err
	}
	_, err := s.exec(ctx, w, nil, &archive, "sh", "-c", `d="$HOME/.kimono/custom-skills"; rm -rf "$d" && mkdir -p "$d" && tar -x --no-same-owner -C "$d"`)
	return err
}
