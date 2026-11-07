package sandbox

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

type hookSettings struct {
	Hooks map[string][]struct {
		Matcher string `json:"matcher"`
		Hooks   []struct {
			Type    string `json:"type"`
			Command string `json:"command"`
		} `json:"hooks"`
	} `json:"hooks"`
}

func agentSettings(t *testing.T) hookSettings {
	t.Helper()
	var s hookSettings
	if err := json.Unmarshal([]byte(SteerSettings), &s); err != nil {
		t.Fatalf("the agent's settings aren't JSON: %v", err)
	}
	return s
}

// The steering hooks are still there beside the guide's.
func TestAgentSettingsKeepSteering(t *testing.T) {
	s := agentSettings(t)
	for _, event := range []string{"SessionStart", "PostToolUse", "Stop"} {
		if len(s.Hooks[event]) != 1 || len(s.Hooks[event][0].Hooks) != 1 {
			t.Fatalf("one %s hook expected: %+v", event, s.Hooks[event])
		}
	}
}

// The guide arrives when a chat starts and again after compaction, but not on
// every resumed turn, where it's already in the conversation.
func TestArtifactGuideOnStartAndCompaction(t *testing.T) {
	matcher := agentSettings(t).Hooks["SessionStart"][0].Matcher
	parts := strings.Split(matcher, "|")
	has := func(want string) bool {
		for _, p := range parts {
			if p == want {
				return true
			}
		}
		return false
	}
	if !has("startup") || !has("compact") || has("resume") || matcher == "*" || matcher == "" {
		t.Fatalf("SessionStart matcher %q: want startup and compact, not resume", matcher)
	}
}

func runGuideHook(t *testing.T, guide string) string {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node isn't here")
	}
	command := agentSettings(t).Hooks["SessionStart"][0].Hooks[0].Command
	cmd := exec.Command("sh", "-c", command)
	cmd.Env = append(os.Environ(), "KIMONO_GUIDE="+guide)
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"SessionStart","source":"startup"}`)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("the guide hook failed: %v %s", err, out)
	}
	return string(out)
}

// The hook hands Claude the whole guide as context, quotes and all.
func TestArtifactGuideHookGivesTheGuide(t *testing.T) {
	guide := filepath.Join(t.TempDir(), "artifacts.md")
	text := "# Artifacts\n\nWrite it to `/workspace/artifacts/<name>.html`.\nIt's \"quoted\" and has a \\ too.\n"
	os.WriteFile(guide, []byte(text), 0o644)
	var said struct {
		HookSpecificOutput struct {
			HookEventName     string `json:"hookEventName"`
			AdditionalContext string `json:"additionalContext"`
		} `json:"hookSpecificOutput"`
	}
	out := runGuideHook(t, guide)
	if err := json.Unmarshal([]byte(out), &said); err != nil {
		t.Fatalf("the hook's output isn't JSON: %v %s", err, out)
	}
	if said.HookSpecificOutput.HookEventName != "SessionStart" {
		t.Fatalf("event %q", said.HookSpecificOutput.HookEventName)
	}
	context := said.HookSpecificOutput.AdditionalContext
	if !strings.HasSuffix(context, text) || !strings.Contains(context, "no need to read it") {
		t.Fatalf("context: %q", context)
	}
}

// The real guide fits: it goes in whole on every new chat, so it must stay small.
func TestArtifactGuideStaysSmall(t *testing.T) {
	guide, err := os.ReadFile("../../../infra/sandbox/artifacts.md")
	if err != nil {
		t.Skip("artifacts.md isn't beside this checkout")
	}
	if len(guide) > 40_000 {
		t.Fatalf("artifacts.md is %d bytes; it's sent whole at every chat's start, so keep it under 40 KB", len(guide))
	}
	if out := runGuideHook(t, "../../../infra/sandbox/artifacts.md"); !strings.Contains(out, "<k-scene>") {
		t.Fatalf("the real guide didn't come through: %.200s", out)
	}
}

// With no guide (an older image), the hook says nothing and doesn't fail.
func TestArtifactGuideHookWithoutAGuide(t *testing.T) {
	if out := runGuideHook(t, filepath.Join(t.TempDir(), "missing.md")); strings.TrimSpace(out) != "" {
		t.Fatalf("no guide, yet it said: %s", out)
	}
}

// An explainer is an artifact, even called a video; drawing frames in Python
// is only for a drawn file to post or send.
func TestExplainerVideosAreArtifacts(t *testing.T) {
	for _, want := range []string{
		"A video that explains something",
		"never frames drawn in Python",
		"anything that explains or teaches is an artifact",
		"they want it as a file to post or send, draw its frames in Python",
	} {
		if !strings.Contains(SystemPrompt, want) {
			t.Fatalf("the system prompt doesn't say %q", want)
		}
	}
	if strings.Contains(SystemPrompt, "when it's drawn, draw its frames in Python") {
		t.Fatal("the old line sending any drawn video to Python is back")
	}
}

// The guide comes with the chat, and files are read with Read, not cat.
func TestPromptDoesntSendItToReadTheGuide(t *testing.T) {
	if strings.Contains(SystemPrompt, "Read /opt/kimono/artifacts.md before your first one") {
		t.Fatal("the prompt still asks for the guide to be read every chat")
	}
	for _, want := range []string{"is given to you when the chat starts", "read files with Read", "not cat"} {
		if !strings.Contains(SystemPrompt, want) {
			t.Fatalf("the system prompt doesn't say %q", want)
		}
	}
}

// Long work that runs here goes through --run, and a check is one command.
func TestPromptTeachesProgressRun(t *testing.T) {
	for _, want := range []string{`--run "<command>"`, "--wait comes back the moment it ends", `kimono-progress --status "Rendering" --percent 40; kimono-progress --wait 60`} {
		if !strings.Contains(SystemPrompt, want) {
			t.Fatalf("the system prompt doesn't say %q", want)
		}
	}
}
