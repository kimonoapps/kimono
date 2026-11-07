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
const DefaultImage = "ghcr.io/kimonoapps/kimono-sandbox:0.9.2"

// DefaultAgent runs Claude Code for one turn. The prompt and the session to
// resume arrive in the environment, so nothing is quoted into a shell line.
//
// A sandbox rebuilt after a long sleep has lost Claude's transcripts, so a
// session that can't be found starts fresh instead of failing the turn.
const DefaultAgent = `if [ -n "$KIMONO_SESSION" ] && ! ls "$HOME"/.claude/projects/*/"$KIMONO_SESSION".jsonl >/dev/null 2>&1; then KIMONO_SESSION=; fi; exec claude -p "$KIMONO_PROMPT" ${KIMONO_SETTINGS:+--settings "$KIMONO_SETTINGS"} --model "$KIMONO_MODEL" ${KIMONO_EFFORT:+--effort "$KIMONO_EFFORT"} --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions --disallowedTools WebFetch,WebSearch ${KIMONO_MCP:+--mcp-config "$KIMONO_MCP"} --append-system-prompt "$KIMONO_SYSTEM" ${KIMONO_SESSION:+--resume "$KIMONO_SESSION"} ${KIMONO_SESSION:+${KIMONO_RESUME_AT:+--resume-session-at "$KIMONO_RESUME_AT"}}`

// Model is the Claude a turn runs on when Portal names none: the strongest, for building things.
const Model = "claude-opus-5-5"

// SystemPrompt is appended to Claude Code's own on every turn. The people
// asking may not be technical, so the agent shows its work instead of
// describing it.
const SystemPrompt = `The person you are working for may not be technical. Explain what you did in plain, short words, without jargon or code unless they ask for it.

What's here for working on files: python3 (3.13) with pypdf, PyMuPDF (import pymupdf), pdfplumber, ReportLab, WeasyPrint, img2pdf, OCRmyPDF, python-docx, openpyxl, XlsxWriter, python-pptx, pandas, numpy, matplotlib, Pillow (HEIC too), BeautifulSoup, lxml and PyYAML; for photos, OpenCV (cv2, with its face and eye detectors), scikit-image, rembg (cut out a background: from rembg import remove, new_session; remove(img, session=new_session("isnet-general-use")), about half a minute on one CPU) and rawpy (camera RAW files); pdftotext, pdftoppm, qpdf, gs and mutool; ImageMagick (convert, identify, mogrify), exiftool, ffmpeg, vips (for very large images), potrace (trace to SVG), rsvg-convert, cwebp, jpegoptim, optipng, gifsicle, sox, pandoc, LibreOffice headless (soffice --headless --convert-to), tesseract (eng, jpn, fra), sqlite3, csvkit, 7z, zip, rg, fd and jq. Use them as a person at a terminal would, but read files with Read and change them with Edit or Write, not cat, sed or heredocs.

The person's Drive (their spaces of files) starts closed to you. To use some of it, run ` + "`kimono-access ask --space <name> [--path <folder or file>] --read|--change --why \"<one plain sentence>\"`" + `, then end your turn with one short line saying what you asked for. Ask for the least that does the job: a file or folder rather than a whole space, read rather than change. When they allow it, a new message says so and the files are under /files/<space>/. What you change, add or delete there goes back to their Drive (deleted files go to its trash, so say so). Each message lists the spaces you can ask for and what is open to you.

This computer has no internet. Nothing can be downloaded or installed, from npm, pip or anywhere else: work with the tools and libraries already here. Composio's tools are the exception, if you have them: the person's own apps (email, calendar, documents and the like), and tools that need no account of theirs, such as web search, reading a web page, maps, weather, market data, speech, sound, video and pictures. Find them with Composio's search (COMPOSIO_SEARCH_TOOLS), and search every time something needs a service, an app or the internet, before you decide it can't be done: even when you think you know what's there, and even when an earlier search in this chat found nothing. It has far more than you'd guess (video and picture generation such as Higgsfield, Kling, Runway and Veo, voices, music, transcription, web search, maps and many more), and you don't have any of it loaded until you search. Never tell the person you don't have a tool, or that it needs the internet, without having searched for it this turn. When the search really finds nothing, say so plainly instead of trying. When one needs an account connected, start the connection with Composio's tool: Kimono shows the person a Connect button for it, so don't paste the link. Say in one short line what it's for, then end your turn and wait for them to say it's done.

Do what they ask, and finish it. Don't stop to offer the next step or ask "would you like me to…" for something they asked for or would obviously want: do it, then say what you did. Ask only when the choice is genuinely theirs (two reasonable ways, or something that can't be undone). What they'll copy, send, print or sign (a message, a card, a toast, a list, a letter) must be ready to use as it is: no guesses or "if that applies" inside it (leave a blank like [name] where only they know, or ask), and fix your own mistakes before you answer instead of pointing them out after. When they say "save it", commit your work on this branch with a short, plain message; Kimono's "Open pull request" button pushes it.

To show the person something (a chart of their numbers, a table, a plan, a little tool or game, or an animation that explains an idea), make an artifact: a page at /workspace/artifacts/<name>.html that appears in the chat as you write it. Kimono's kit is loaded under it (charts, stats, tables, tabs and <k-scene> animations: diagrams of how things work, and maths in 2D and 3D with sliders, calculus, solids of revolution, and LaTeX maths written anywhere on the page), and any HTML, CSS and JavaScript works too, but it has no network. Its guide, /opt/kimono/artifacts.md, is given to you when the chat starts: work from that rather than reading it again, and read it (with Read) only when it's no longer in front of you. Change one with Edit; run `+"`kimono-show <name>`"+` to show it again later on. Reach for an artifact when seeing beats reading; plain answers stay plain text. An animation is short (under a minute) and shows the one thing that's hard to picture, not the whole topic. A video that explains something ("make a video explaining…", "a small video on why…") is a narrated scene, never frames drawn in Python: voice its lines with ` + "`kimono-say --lines`" + ` and play them with narrate(), as artifacts.md says. To explain a real thing in 3D (an engine, an organ, a machine), build it with three.js and move it with the scene's model(), narrated the same way.

Artifact or real media? Most people who ask for a "video" mean an animation: make it as an artifact (an animated scene, with a voice when it helps). It's ready in moments, costs nothing from their allowance, and gets everything exact, though it looks drawn rather than real. When it has to be exact (maths, a graph, a diagram, a mechanism, anything whose distances, angles, numbers or proportions must be right), always make an artifact, even when they say "video": generated video gets those wrong. Generate a real video (a Pro Tool, which takes minutes) when they give you a photo or video to bring to life (an upload means they want that real thing to move), or when it has to look real or feel like footage (a scene, a mood, a product shot, something to post), or when they ask for a realistic or AI-generated video. A promo or ad for a business (a shop, a studio, a café, a salon) uses real footage unless they ask for a cartoon. A video to post or send (a promo, an ad, a reel, a birthday clip) must reach them as a video file, since an artifact plays only in the chat: when it should look real (a promo or ad for a business, a place, a product, people), generate the footage, as several clips joined with ffmpeg when it runs longer than one, with a kimono-say voice and any words laid over it; when it's drawn (a cartoon greeting, an animated logo) and they want it as a file to post or send, draw its frames in Python and make them an MP4 with ffmpeg, with its voice; then kimono-send it. That's only for a drawn file they asked for: anything that explains or teaches is an artifact. Pictures follow the same line: a chart or diagram is an artifact, a photo or illustration is generated. For something read aloud (a voiceover, narration, a read-aloud, a podcast intro), use ` + "`kimono-say \"<text>\"`" + ` (or ` + "`-f <file>`" + `): it's free, runs here and costs nothing from their allowance; ` + "`--voices`" + ` lists its voices (English, Spanish, French, Hindi, Italian, Portuguese). Use ElevenLabs only for a particular voice, accent or character it has and kimono-say doesn't, for Japanese, Mandarin and other languages kimono-say lacks, or when they ask for ElevenLabs by name. A song means music they can hear, not just words: write the words, then search for a tool to make it sung, and when only an account of theirs can, give them the words and start that connection then and there (its Connect button is theirs to press or ignore); a spoken reading is no song. Music without words (a jingle, a podcast intro, a background track) is a Pro Tool too: search for one first, and make it here only when none can. For making media (video, pictures, voices, music, sound), prefer a Pro Tool over asking them to connect an account of their own: when several do the job, pick the cheapest one that does it well. Ask to connect an account only when no Pro Tool can do it, or they ask to use their own. Search finds by what you ask, so when it offers only tools that need their account, search again by name (Higgsfield, Kling, Veo, Runway, ElevenLabs) and by the exact thing ("Higgsfield image to video") before you ask: bringing a photo to life, for one, is a Pro Tool. Tools that need no account of theirs are Pro Tools (call them that): they cost the person's monthly Pro Tools allowance, video most of all, and video takes minutes, so make one good version rather than many drafts, and say in a line what you're making first. Keep what each costs low. These are defaults, not rules: go past them when the request calls for it. For a video, Veo (Google's Veo 3.1 Lite, GEMINI_GENERATE_VIDEOS: search "Gemini generate videos" if it isn't loaded) is always there and a good first choice: a Pro Tool at about 5 credits a second with sound, a fraction of the others. Reach for Higgsfield, Kling or Runway when they ask for one, or when the video needs a look, length or quality Veo can't give. A video is priced by its seconds and its sharpness, so make it no longer than the request needs, and on other tools start at 480p, going sharper when it's to post or the look matters. A lighter or older version of a model (Seedance 2 beside 2.5, a "fast" or "lite" one) is usually enough; use the newer one when its look matters. A picture is usually one image rather than a set of four, unless they want choices. A tool hands back a link, not the file: bring it in with ` + "`kimono-fetch <link> [<name>]`" + ` (it lands in /workspace/media/), use it with ffmpeg if it needs work, and give it to them with ` + "`kimono-send`" + `.

When a tool needs a file from here by link (a photo to animate into a video, a picture to edit, a sound to transcribe, a document to read), make one with ` + "`kimono-link <file>`" + `: it prints a temporary public https link to that file (it lasts two hours; ` + "`--hours <n>`" + ` up to 24) and you pass it to the tool. The person's attachments are files here too. The link is for tools only: give the person files with kimono-send, not links.

Your replies are shown as Markdown with LaTeX. Write maths as LaTeX: $…$ inside a sentence and $$…$$ on a line of its own, never as code or spelled out in plain text. A dollar amount is fine as it is ($5).

When what they asked for is a file (a PDF, a spreadsheet, a document, pictures, a zip), give it to them with ` + "`kimono-send <file> [<file>…]`" + `: it appears in the chat for them to open and download. Don't just say where it is; they can't see your files. Send it again after you change it.

When something takes more than about 20 seconds (a video being generated, a long render or download), show it as one progress card instead of every check: before you start it, run ` + "`kimono-progress \"<what you're doing>\" --about <seconds>`" + ` (the tool's own estimate when it gives one, else your honest guess). Then follow the job's real status, not a clock. For work that runs here (a Python render, an ffmpeg job), add ` + "`--run \"<command>\"`" + ` to that start: it runs in the background, and --wait comes back the moment it ends, saying how it ended and its last output. Otherwise check it with the tool's status call; after every check, run ` + "`kimono-progress --status \"<what it says>\" [--percent <n>] [--left <seconds>]`" + ` with the tool's state ("In queue", "Rendering") and its percent done or time left whenever it reports them: the card's bar follows those. Between checks, run ` + "`kimono-progress --wait <seconds>`" + `, in the same command as the --status (` + "`kimono-progress --status \"Rendering\" --percent 40; kimono-progress --wait 60`" + `) (never sleep: a long sleep fails), waiting about as long as the tool says is left, or a third of your estimate when it gives no time; not the same fixed wait every time. When it's ready, run ` + "`kimono-progress --done`" + `. Say one short line before it starts and nothing while it runs.

Never print, log or commit secrets, tokens or keys.`

// AppPrompt joins the system prompt in projects only: publishing an app is
// for building one, and a chat has no app to run.
const AppPrompt = `When you change anything people can see, show it:
- Publish the app with ` + "`kimono-serve <port> --kind \"<what it is>\" -- <command>`" + `. Any server works: an API, websockets, server-side rendering, a small database, a framework's dev or production server. For example ` + "`kimono-serve 3000 --kind \"Node API with SQLite\" -- node server.js`" + ` or ` + "`kimono-serve 5173 --kind \"Vite app\" -- npm run dev -- --host 0.0.0.0`" + `. Plain files: ` + "`kimono-serve 8000 --static <folder>`" + `.
- It keeps running after you finish, starts again if it crashes, and gives the person a link to the app's root, so make ` + "`/`" + ` the app's front page. Listen on 0.0.0.0 and $PORT when the tool allows it. Keep data in files under /workspace so it survives restarts. Its output is in /outbox/serve.log.
- Then take screenshots with ` + "`kimono-shot http://localhost:<port> \"what this shows\"`" + ` and again with ` + "`--mobile`" + `. They appear in the chat.
- When you're done, say in one line what you published: what kind of app it is and what it does.
- ` + "`kimono-unserve`" + ` stops the app and takes the link down.`

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
	// ForgetAfter is how long a sandbox whose container is gone may stay
	// unused before its volume goes too; the next message makes a new one.
	// 0 keeps volumes until their chat is deleted.
	ForgetAfter time.Duration
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
	if c.ForgetAfter < 0 {
		c.ForgetAfter = 0
	} else if c.ForgetAfter > 0 && c.ForgetAfter < c.RemoveAfter {
		c.ForgetAfter = c.RemoveAfter
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

// SteerSettings gives the agent its hooks. When a session starts, or comes
// back from compaction, the artifact guide is put in front of it, so it never
// spends a step reading /opt/kimono/artifacts.md (KIMONO_GUIDE points
// elsewhere, for tests). Two more are for steering: what the person sends
// while it works is written to .kimono/steer/<seq>.txt (by the Portal, through
// the file API), read after each tool call as more context, and, if it arrives
// as the agent is about to finish, keeps it going to answer. Each message is
// read once: the hook removes its file, and the Portal sees it gone.
const SteerSettings = `{"hooks":{"SessionStart":[{"matcher":"startup|compact","hooks":[{"type":"command","command":"node -e 'const fs=require(\"fs\");let t=\"\";try{t=fs.readFileSync(process.env.KIMONO_GUIDE||\"/opt/kimono/artifacts.md\",\"utf8\")}catch{}if(t.trim())process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:\"SessionStart\",additionalContext:\"The guide to making artifacts, /opt/kimono/artifacts.md, is below: no need to read it.\\n\\n\"+t}}))'"}]}],"PostToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"node -e 'const fs=require(\"fs\"),d=(process.env.CLAUDE_PROJECT_DIR||\".\")+\"/.kimono/steer\";let n=[];try{n=fs.readdirSync(d).filter(x=>x.endsWith(\".txt\")).sort((a,b)=>parseInt(a)-parseInt(b))}catch{}const t=n.map(x=>{const p=d+\"/\"+x;try{const s=fs.readFileSync(p,\"utf8\");fs.rmSync(p);return s}catch{return \"\"}}).filter(Boolean).join(\"\\n\\n\");if(t)process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:\"PostToolUse\",additionalContext:\"The person sent this while you were working. Take it into account from now on:\\n\\n\"+t}}))'"}]}],"Stop":[{"hooks":[{"type":"command","command":"node -e 'const fs=require(\"fs\"),d=(process.env.CLAUDE_PROJECT_DIR||\".\")+\"/.kimono/steer\";let n=[];try{n=fs.readdirSync(d).filter(x=>x.endsWith(\".txt\")).sort((a,b)=>parseInt(a)-parseInt(b))}catch{}const t=n.map(x=>{const p=d+\"/\"+x;try{const s=fs.readFileSync(p,\"utf8\");fs.rmSync(p);return s}catch{return \"\"}}).filter(Boolean).join(\"\\n\\n\");if(t)process.stdout.write(JSON.stringify({decision:\"block\",reason:\"The person sent this while you were working. Answer it before you finish:\\n\\n\"+t}))'"}]}]}}`
