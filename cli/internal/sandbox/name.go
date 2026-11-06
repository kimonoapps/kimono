package sandbox

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// namePrompt is all Claude is told when it names a chat.
const namePrompt = "You name chats. Reply with only a short title for the conversation you are given: 2 to 6 words, sentence case, no quotes, no trailing period, no emoji. A noun phrase naming what it is about, like a file name (\"This week's schedule\", \"Birthday dinner for eight\"), not a sentence or what the assistant did. Use the language the person wrote in."

// nameAgent asks Haiku for a chat's name, once, with no tools, no MCP and no
// session left behind: Claude Code itself, so the plan's credential is used
// the way it is meant to be.
const nameAgent = `exec claude -p "$KIMONO_PROMPT" --model "$KIMONO_MODEL" --system-prompt "$KIMONO_SYSTEM" --tools "" --strict-mcp-config --no-session-persistence --output-format text`

// handleName answers with a name for a chat from its first exchange
// ({"conversation": "..."} → {"title": "..."}). An empty title is no name.
func (s *Server) handleName(w http.ResponseWriter, r *http.Request, id string) error {
	var request struct {
		Conversation string `json:"conversation"`
	}
	if err := readJSON(r, 16<<10, &request); err != nil {
		return err
	}
	conversation := strings.TrimSpace(request.Conversation)
	if conversation == "" {
		return problem(400, "Give the conversation to name.")
	}
	space, err := s.remembered(id)
	if err != nil {
		return err
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}
	ctx, done := context.WithTimeout(r.Context(), 45*time.Second)
	defer done()
	extra := []string{"KIMONO_PROMPT=" + truncate(conversation, 4000), "KIMONO_SYSTEM=" + namePrompt, "KIMONO_MODEL=" + Models["haiku"]}
	output, err := s.docker.run(ctx, nil, s.execArgs(space, extra, false, "sh", "-c", nameAgent)...)
	if err != nil {
		s.cfg.Logf("naming %s: %v", id, err)
		return problem(502, "Kimono AI couldn't think of a name.")
	}
	space.touch()
	writeJSON(w, 200, map[string]string{"title": strings.TrimSpace(string(output))})
	return nil
}
