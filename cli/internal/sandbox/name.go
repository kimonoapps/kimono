package sandbox

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// namePrompt is all Claude is told when it names a chat.
const namePrompt = "You name chats. Reply with only a short title for the conversation you are given: 2 to 6 words, sentence case, no quotes, no trailing period, no emoji. A noun phrase naming what it is about, like a file name (\"This week's schedule\", \"Birthday dinner for eight\"), not a sentence or what the assistant did. Use the language the person wrote in."

// nameAgent asks Haiku for a chat's name, once, with no tools, no MCP and no
// session left behind: Claude Code itself, so the plan's credential is used
// the way it is meant to be. Everyone's chats are named in this one container, so
// each call gets a home of its own, gone when it returns: nothing Claude Code
// writes from one person's conversation is there for the next. A call cut off at its
// timeout can't clean up after itself, so each also sweeps away homes left over a while.
const nameAgent = `find /tmp -maxdepth 1 -name 'name.*' -mmin +2 -exec rm -rf {} + 2>/dev/null
h=$(mktemp -d /tmp/name.XXXXXXXX) || exit 1
trap 'rm -rf "$h"' HUP INT TERM
HOME="$h" claude -p "$KIMONO_PROMPT" --model "$KIMONO_MODEL" --system-prompt "$KIMONO_SYSTEM" --tools "" --strict-mcp-config --no-session-persistence --output-format text
status=$?
rm -rf "$h"
exit $status`

// namerName is the one container chats are named in: from the sandbox image, so it
// has Claude Code, but no one's files, no tools and no connections, shared by every
// chat and kept warm, so naming never waits on a chat's own sandbox.
const namerName = "kimono-namer"

// handleName answers with a name for a chat from its first exchange
// ({"conversation": "...", "model": {"token": "..."}} → {"title": "..."}). An empty
// title is no name. It needs nothing of the chat's own sandbox, so it can run as the
// chat's first message is sent, while that sandbox is still being made.
func (s *Server) handleName(w http.ResponseWriter, r *http.Request, id string) error {
	var request struct {
		Conversation string    `json:"conversation"`
		Model        ModelAuth `json:"model"`
	}
	if err := readJSON(r, 16<<10, &request); err != nil {
		return err
	}
	conversation := strings.TrimSpace(request.Conversation)
	if conversation == "" {
		return problem(400, "Give the conversation to name.")
	}
	/* The plan's credential, as the Portal gives it; a Portal from before sends none, and the chat's own is used. */
	token := strings.TrimSpace(request.Model.Token)
	if token == "" {
		if space, err := s.remembered(id); err == nil {
			space.mu.Lock()
			token = space.model.Token
			space.mu.Unlock()
		}
	}
	if token == "" {
		return problem(400, "Kimono Code has no Claude credential to name with.")
	}
	ctx, done := context.WithTimeout(r.Context(), 45*time.Second)
	defer done()
	if err := s.namer(ctx); err != nil {
		s.cfg.Logf("naming %s: the naming container: %v", id, err)
		return problem(502, "Kimono AI couldn't think of a name.")
	}
	// The model answers a sandbox only while a turn runs: naming gets a key of its own for this
	// one call (the gateway's naming), standing for this chat, gone when it returns.
	key := randomToken()
	s.mu.Lock()
	s.naming[key] = &workspace{id: id, model: ModelAuth{Token: token}}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.naming, key)
		s.mu.Unlock()
	}()
	args := []string{"exec", "-u", "agent", "-w", "/home/agent"}
	for _, value := range []string{
		"HOME=/home/agent",
		"ANTHROPIC_BASE_URL=" + strings.TrimRight(s.gatewayURL, "/") + "/anthropic",
		"ANTHROPIC_API_KEY=" + key,
		"DISABLE_AUTOUPDATER=1",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
		"KIMONO_PROMPT=" + truncate(conversation, 4000),
		"KIMONO_SYSTEM=" + namePrompt,
		"KIMONO_MODEL=" + Models["haiku"],
	} {
		args = append(args, "-e", value)
	}
	output, err := s.docker.run(ctx, nil, append(args, namerName, "sh", "-c", nameAgent)...)
	if err != nil {
		s.cfg.Logf("naming %s: %v: %s", id, err, truncate(strings.TrimSpace(string(output)), 300))
		return problem(502, "Kimono AI couldn't think of a name.")
	}
	writeJSON(w, 200, map[string]string{"title": strings.TrimSpace(string(output))})
	return nil
}

// namer makes sure the naming container is up, on this node's image: made the
// first time, woken if Docker stopped it, made again when the image changed.
func (s *Server) namer(ctx context.Context) error {
	s.namerMu.Lock()
	defer s.namerMu.Unlock()
	out, err := s.docker.run(ctx, nil, "container", "inspect", "-f", "{{.State.Status}} {{.Config.Image}}", namerName)
	state, image := "", ""
	if err == nil {
		state, image, _ = strings.Cut(strings.TrimSpace(string(out)), " ")
	} else if !strings.Contains(strings.ToLower(err.Error()), "no such") {
		return err
	}
	if state != "" && image != s.cfg.Image {
		_, _ = s.docker.run(ctx, nil, "rm", "-f", namerName)
		state = ""
	}
	switch state {
	case "running":
		return nil
	case "paused":
		_, err = s.docker.run(ctx, nil, "unpause", namerName)
		return err
	case "":
	default:
		if _, err = s.docker.run(ctx, nil, "start", namerName); err == nil {
			return nil
		}
		_, _ = s.docker.run(ctx, nil, "rm", "-f", namerName)
	}
	/* As a sandbox is made (create in workspace.go), with no volume and a small share of the machine. */
	args := []string{"run", "-d", "--name", namerName, "--label", "kimono.namer=1",
		"--hostname", "namer", "--network", s.cfg.Network, "--restart", "unless-stopped",
		"--pids-limit", "256", "--cpus", "1", "--memory", "768m",
		"--init", "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
		"--user", "agent", "--workdir", "/home/agent", "--dns", "127.0.0.1"}
	if s.runtime == "runsc" {
		args = append(args, "--runtime", "runsc")
	}
	if gatewayHost := s.desktopGatewayHost(); gatewayHost != "" {
		args = append(args, "--add-host", gatewayHost+":host-gateway")
	}
	if s.firewall != nil {
		if err := s.recheckFirewall(ctx); err != nil {
			return fmt.Errorf("the sandbox firewall: %w", err)
		}
	}
	args = append(args, s.cfg.Image, "sleep", "infinity")
	if _, err := s.docker.run(ctx, nil, args...); err != nil {
		return fmt.Errorf("start the naming container: %w", err)
	}
	return s.probeOffline(ctx, namerName)
}
