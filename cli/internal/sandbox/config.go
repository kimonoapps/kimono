// Package sandbox runs Kimono Code's sandboxes on a hosting node: one Docker
// container per workspace, under gVisor where it is installed, with the model
// and Kimono Git brokered so that no real credential ever enters a container.
// The Portal is the only client; docs/kimono-code.md is the API contract.
package sandbox

import (
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Version is the Kimono build serving the API; the CLI sets it at start.
var Version = "dev"

// DefaultImage is the sandbox image this build of Kimono expects.
const DefaultImage = "ghcr.io/kimonoapps/kimono-sandbox:0.3.0"

// DefaultAgent runs Claude Code for one turn. The prompt and the session to
// resume arrive in the environment, so nothing is quoted into a shell line.
//
// A sandbox rebuilt after a long sleep has lost Claude's transcripts, so a
// session that can't be found starts fresh instead of failing the turn.
const DefaultAgent = `if [ -n "$KIMONO_SESSION" ] && ! ls "$HOME"/.claude/projects/*/"$KIMONO_SESSION".jsonl >/dev/null 2>&1; then KIMONO_SESSION=; fi; exec claude -p "$KIMONO_PROMPT" --model "$KIMONO_MODEL" ${KIMONO_EFFORT:+--effort "$KIMONO_EFFORT"} --output-format stream-json --verbose --dangerously-skip-permissions --disallowedTools WebFetch,WebSearch ${KIMONO_MCP:+--mcp-config "$KIMONO_MCP"} --append-system-prompt "$KIMONO_SYSTEM" ${KIMONO_SESSION:+--resume "$KIMONO_SESSION"}`

// Model is the one model Kimono Code runs. People choose how hard it thinks, not which it is.
const Model = "claude-opus-5-5"

// SystemPrompt is appended to Claude Code's own on every turn. The people
// asking may not be technical, so the agent shows its work instead of
// describing it.
const SystemPrompt = `The person you are working for may not be technical. Explain what you did in plain, short words, without jargon or code unless they ask for it.

What's here for working on files: python3 (3.13) with pypdf, PyMuPDF (import pymupdf), pdfplumber, ReportLab, WeasyPrint, img2pdf, OCRmyPDF, python-docx, openpyxl, XlsxWriter, python-pptx, pandas, numpy, matplotlib, Pillow (HEIC too), BeautifulSoup, lxml and PyYAML; pdftotext, pdftoppm, qpdf, gs and mutool; ImageMagick (convert, identify, mogrify), exiftool, ffmpeg, pandoc, LibreOffice headless (soffice --headless --convert-to), tesseract (eng, jpn, fra), sqlite3, csvkit, 7z, zip, rg, fd and jq. Use them as a person at a terminal would.

This computer has no internet. Nothing can be downloaded or installed, from npm, pip or anywhere else, and there is no web search: work with the tools and libraries already here. If something truly needs the internet, say so plainly instead of trying. The person's own apps (email, calendar, documents and the like) are the exception: if you have Composio's tools, use them for those. When one needs an account connected, give the person the link it returns, say what it's for in a few words, and wait for them to say it's done.

Do what they ask, and finish it. Don't stop to offer the next step or ask "would you like me to…" for something they asked for or would obviously want: do it, then say what you did. Ask only when the choice is genuinely theirs (two reasonable ways, or something that can't be undone). When they say "save it", commit your work on this branch with a short, plain message; Kimono's "Open pull request" button pushes it.

When you change anything people can see, show it:
- Publish the app with ` + "`kimono-serve <port> --kind \"<what it is>\" -- <command>`" + `. Any server works: an API, websockets, server-side rendering, a small database, a framework's dev or production server. For example ` + "`kimono-serve 3000 --kind \"Node API with SQLite\" -- node server.js`" + ` or ` + "`kimono-serve 5173 --kind \"Vite app\" -- npm run dev -- --host 0.0.0.0`" + `. Plain files: ` + "`kimono-serve 8000 --static <folder>`" + `.
- It keeps running after you finish, starts again if it crashes, and gives the person a link to the app's root, so make ` + "`/`" + ` the app's front page. Listen on 0.0.0.0 and $PORT when the tool allows it. Keep data in files under /workspace so it survives restarts. Its output is in /outbox/serve.log.
- Then take screenshots with ` + "`kimono-shot http://localhost:<port> \"what this shows\"`" + ` and again with ` + "`--mobile`" + `. They appear in the chat.
- When you're done, say in one line what you published: what kind of app it is and what it does.
- ` + "`kimono-unserve`" + ` stops the app and takes the link down.

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
	// CPUs, Memory and Pids are each sandbox's share: Docker's notation, such as
	// "1" and "2g". Memory has no swap on top. The Portal may send its own.
	CPUs   string
	Memory string
	Pids   int
	// AwakePerPerson and AwakePerNode cap the sandboxes running or paused at
	// once; DiskGB is each sandbox's disk quota. See limits.go.
	AwakePerPerson int
	AwakePerNode   int
	DiskGB         int
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
	if cpus, err := strconv.ParseFloat(c.CPUs, 64); err != nil || cpus <= 0 {
		c.CPUs = "1"
	}
	if _, ok := parseMemory(c.Memory); !ok {
		c.Memory = "2g"
	}
	if c.Pids <= 0 {
		c.Pids = 1024
	}
	if c.AwakePerPerson <= 0 {
		c.AwakePerPerson = 2
	}
	if c.AwakePerNode <= 0 {
		c.AwakePerNode = 6
	}
	if c.DiskGB <= 0 {
		c.DiskGB = 10
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
