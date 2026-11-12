package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeDockerFor is a docker CLI whose `exec` answers what the probe found, and
// which writes every call it gets to a log.
func fakeDockerFor(t *testing.T, answer string) (docker, string) {
	dir := t.TempDir()
	log := filepath.Join(dir, "calls")
	script := "#!/bin/sh\necho \"$@\" >> " + log + "\nif [ \"$1\" = exec ]; then echo " + answer + "; fi\n"
	bin := filepath.Join(dir, "docker")
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	return docker{bin: bin}, log
}

func calls(t *testing.T, log string) string {
	out, _ := os.ReadFile(log)
	return string(out)
}

func TestProbeRefusesASandboxThatReachesTheWeb(t *testing.T) {
	d, log := fakeDockerFor(t, "reached")
	s := &Server{cfg: Config{Logf: t.Logf}, docker: d, firewall: &firewallPlan{}}
	err := s.probeOffline(context.Background(), "kimono-sb-x")
	if err == nil || !strings.Contains(err.Error(), "could reach the web") {
		t.Fatalf("want a refusal, got %v", err)
	}
	if !strings.Contains(calls(t, log), "rm -f kimono-sb-x") {
		t.Fatalf("the sandbox must be removed:\n%s", calls(t, log))
	}
	if !strings.Contains(calls(t, log), offlineProbe) {
		t.Fatalf("the probe must try %s:\n%s", offlineProbe, calls(t, log))
	}
}

func TestProbeLetsAnOfflineSandboxRun(t *testing.T) {
	d, log := fakeDockerFor(t, "blocked")
	s := &Server{cfg: Config{Logf: t.Logf}, docker: d, firewall: &firewallPlan{}}
	if err := s.probeOffline(context.Background(), "kimono-sb-x"); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(calls(t, log), "rm ") {
		t.Fatalf("an offline sandbox was removed:\n%s", calls(t, log))
	}
}

func TestProbeOnlyWarnsWithoutAFirewall(t *testing.T) {
	d, log := fakeDockerFor(t, "reached")
	s := &Server{cfg: Config{Logf: t.Logf}, docker: d}
	if err := s.probeOffline(context.Background(), "kimono-sb-x"); err != nil {
		t.Fatalf("development without a firewall should warn, not fail: %v", err)
	}
	if strings.Contains(calls(t, log), "rm ") {
		t.Fatal("removed without a firewall")
	}
}

// WebFetch would reach the web from the sandbox, so it stays off. WebSearch runs
// on Anthropic's side, through the model gateway, so the sandbox stays offline
// and search is there from the first word, without waiting on Composio.
func TestAgentSearchesButNeverFetches(t *testing.T) {
	if !strings.Contains(DefaultAgent, "--disallowedTools WebFetch${") {
		t.Fatal("the agent must run without WebFetch")
	}
	if strings.Contains(DefaultAgent, "WebSearch") {
		t.Fatal("the agent should have WebSearch")
	}
	if !strings.Contains(SystemPrompt, "not a Composio search tool") {
		t.Fatal("the agent isn't told to search with WebSearch")
	}
}

// On Docker Desktop the gateway is the Mac itself, reached as
// host.docker.internal; with no resolver in the sandbox that one name has to
// be pinned, or the agent never reaches the model. Nowhere else is it added.
func TestDesktopPinsOnlyTheGatewayName(t *testing.T) {
	s := &Server{gatewayURL: "http://host.docker.internal:7481"}
	was := dockerDesktop
	defer func() { dockerDesktop = was }()
	dockerDesktop = true
	if got := s.desktopGatewayHost(); got != "host.docker.internal" {
		t.Fatalf("on Docker Desktop, pinned %q", got)
	}
	dockerDesktop = false
	if got := s.desktopGatewayHost(); got != "" {
		t.Fatalf("on Linux, pinned %q; sandboxes there reach the gateway by address", got)
	}
	dockerDesktop = true
	s.gatewayURL = "http://172.24.0.1:7481"
	if got := s.desktopGatewayHost(); got != "" {
		t.Fatalf("with a gateway address, pinned %q", got)
	}
}
