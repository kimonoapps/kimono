// Package sandbox runs Kimono Code's sandboxes on a hosting node: one Docker
// container per workspace, under gVisor where it is installed, with the model
// and Kimono Git brokered so that no real credential ever enters a container.
// The Portal is the only client; docs/kimono-code.md is the API contract.
package sandbox

import (
	"fmt"
	"runtime"
	"strings"
	"time"
)

// Version is the Kimono build serving the API; the CLI sets it at start.
var Version = "dev"

// DefaultImage is the sandbox image this build of Kimono expects.
const DefaultImage = "ghcr.io/kimonoapps/kimono-sandbox:0.1.0"

// DefaultAgent runs Claude Code for one turn. The prompt and the session to
// resume arrive in the environment, so nothing is quoted into a shell line.
const DefaultAgent = `exec claude -p "$KIMONO_PROMPT" --output-format stream-json --verbose --dangerously-skip-permissions --append-system-prompt "$KIMONO_SYSTEM" ${KIMONO_SESSION:+--resume "$KIMONO_SESSION"}`

// SystemPrompt is appended to Claude Code's own on every turn. The people
// asking may not be technical, so the agent shows its work instead of
// describing it.
const SystemPrompt = `The person you are working for may not be technical. Explain what you did in plain, short words, without jargon or code unless they ask for it.

When you change anything people can see, show it:
- Run the app with ` + "`kimono-serve <port> -- <command>`" + `, for example ` + "`kimono-serve 3000 -- npm run dev -- --host 0.0.0.0`" + `. It keeps running after you finish and gives the person a link to open. Listen on 0.0.0.0 when the tool allows it.
- Then take screenshots with ` + "`kimono-shot http://localhost:<port> \"what this shows\"`" + ` and again with ` + "`--mobile`" + `. They appear in the chat.
- ` + "`kimono-unserve`" + ` stops the app.

Never print, log or commit secrets, tokens or keys.`

// DevGitHost is the repository host served from --dev-git-dir. Development only.
const DevGitHost = "dev.git"

type Config struct {
	// Listen is the API's address, normally the node's mesh IP and port 7480.
	Listen string
	// Key is the bearer token the Portal presents.
	Key   string
	Image string
	// Runtime forces a container runtime; empty picks runsc when Docker has it.
	Runtime string
	// GatewayListen is where the model gateway and Git broker listen; empty
	// means the sandbox network's gateway IP (or loopback on macOS).
	GatewayListen string
	// GatewayURL is that listener as a container reaches it; empty derives it.
	GatewayURL string
	Network    string
	CPUs       string
	Memory     string
	Pids       int
	// PauseAfter, StopAfter and RemoveAfter are how long a sandbox stays
	// quiet before it is paused, stopped, and its container removed (its files
	// stay on their volume). RemoveAfter 0 never removes.
	PauseAfter  time.Duration
	StopAfter   time.Duration
	RemoveAfter time.Duration
	// Agent is the shell command a turn runs inside the container.
	Agent string
	// AnthropicUpstream is where the model gateway forwards.
	AnthropicUpstream string
	// DevGitDir serves bare repositories under it as http://dev.git/… so the
	// whole flow works without Kimono Git. Never set on a real node.
	DevGitDir string
	// StateDir keeps what must survive a restart: the live previews.
	StateDir string
	// PreviewListen is the preview proxy's address.
	PreviewListen string
	// PreviewDomain is the wildcard domain previews are reached under; empty
	// means http://<name>.localhost:<port>.
	PreviewDomain string
	// SystemPrompt is appended to the agent's on every turn.
	SystemPrompt string
	Docker       string
	Logf         func(format string, args ...any)
}

func (c *Config) defaults() error {
	if c.Key == "" {
		return fmt.Errorf("a node key is required")
	}
	if c.Listen == "" {
		c.Listen = "127.0.0.1:7480"
	}
	if c.Image == "" {
		c.Image = DefaultImage
	}
	if c.Network == "" {
		c.Network = "kimono-sandboxes"
	}
	if c.CPUs == "" {
		c.CPUs = "4"
	}
	if c.Memory == "" {
		c.Memory = "8g"
	}
	if c.Pids == 0 {
		c.Pids = 2048
	}
	if c.PauseAfter <= 0 {
		c.PauseAfter = time.Minute
	}
	if c.StopAfter <= 0 {
		c.StopAfter = 15 * time.Minute
	}
	if c.StopAfter < c.PauseAfter {
		c.StopAfter = c.PauseAfter
	}
	if c.RemoveAfter < 0 {
		c.RemoveAfter = 0
	} else if c.RemoveAfter > 0 && c.RemoveAfter < c.StopAfter {
		c.RemoveAfter = c.StopAfter
	}
	if c.Agent == "" {
		c.Agent = DefaultAgent
	}
	if c.AnthropicUpstream == "" {
		c.AnthropicUpstream = "https://api.anthropic.com"
	}
	if c.StateDir == "" {
		c.StateDir = "/var/lib/kimono/sandboxes"
	}
	if c.PreviewListen == "" {
		c.PreviewListen = "127.0.0.1:7482"
	}
	c.PreviewDomain = strings.Trim(strings.ToLower(c.PreviewDomain), ".")
	if c.SystemPrompt == "" {
		c.SystemPrompt = SystemPrompt
	}
	if c.Docker == "" {
		c.Docker = "docker"
	}
	if c.Logf == nil {
		c.Logf = func(string, ...any) {}
	}
	return nil
}

// macOS runs Docker in a VM: containers reach the host as host.docker.internal.
var dockerDesktop = runtime.GOOS == "darwin"
