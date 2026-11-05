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

func TestAgentHasNoWebTools(t *testing.T) {
	if !strings.Contains(DefaultAgent, "--disallowedTools WebFetch,WebSearch") {
		t.Fatal("the agent must run without WebFetch and WebSearch")
	}
}
