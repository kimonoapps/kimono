package sandbox

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// healingNode is a node whose sandbox is up but whose app may not be: the fake
// docker answers as the container would, and the app answers once kimono-serve ran.
func healingNode(t *testing.T, supervisor string) (s *Server, get func() (int, string), starts func() int) {
	t.Helper()
	dir := t.TempDir()
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "the app") }))
	t.Cleanup(app.Close)
	if supervisor != "" {
		os.WriteFile(filepath.Join(dir, "supervisor"), []byte(supervisor), 0644)
	}
	fake := filepath.Join(dir, "docker")
	script := fmt.Sprintf(`#!/bin/sh
d=%q
case "$*" in
  *"container inspect"*) echo running ;;
  *"serve-status"*) cat "$d/supervisor" 2>/dev/null || printf 'gone\n' ;;
  *"/dev/tcp/"*) [ -f "$d/served" ] ;;
  *kimono-serve*) touch "$d/served"; echo x >> "$d/starts" ;;
esac
`, dir)
	if err := os.WriteFile(fake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	s, _ = New(Config{Key: "k", StateDir: t.TempDir(), Docker: fake})
	s.docker = docker{bin: fake}
	s.dial = func(ctx context.Context, _ string, _ int) (net.Conn, error) {
		if _, err := os.Stat(filepath.Join(dir, "served")); err != nil {
			return nil, errors.New("connection refused")
		}
		return (&net.Dialer{}).DialContext(ctx, "tcp", app.Listener.Addr().String())
	}
	s.previews["ws1"] = &preview{Name: "site-abc123", Port: 3000, Args: []string{"node", "server.js"}}
	front := httptest.NewServer(s.PreviewHandler())
	t.Cleanup(front.Close)
	get = func() (int, string) {
		request, _ := http.NewRequest("GET", front.URL+"/", nil)
		request.Host = "site-abc123.localhost:7482"
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		return response.StatusCode, string(body)
	}
	starts = func() int {
		raw, _ := os.ReadFile(filepath.Join(dir, "starts"))
		return strings.Count(string(raw), "x")
	}
	return s, get, starts
}

// TestAnAppThatDiedInARunningSandboxComesBack: the sandbox is awake, its app
// isn't (it died, or Docker brought the container back without it). Opening
// the link starts the app again and says it's waking, instead of "isn't
// running" until someone presses Restart.
func TestAnAppThatDiedInARunningSandboxComesBack(t *testing.T) {
	_, get, starts := healingNode(t, "")
	status, body := get()
	if status != http.StatusServiceUnavailable || !strings.Contains(body, "Waking up") {
		t.Fatalf("first visit: %d %q", status, body)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if status, body = get(); status == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the app never came back: %d %q", status, body)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if body != "the app" || starts() != 1 {
		t.Fatalf("%q, started %d times", body, starts())
	}
}

// An app its supervisor is still starting isn't started a second time; one
// that keeps crashing isn't started at all (its log says why).
func TestAnAppStillStartingOrCrashingIsLeftToItsSupervisor(t *testing.T) {
	_, get, starts := healingNode(t, "alive\nrunning\n")
	if status, body := get(); status != http.StatusServiceUnavailable || !strings.Contains(body, "Waking up") {
		t.Fatalf("starting: %d %q", status, body)
	}
	time.Sleep(300 * time.Millisecond)
	if starts() != 0 {
		t.Fatal("an app still starting was started again")
	}

	_, get, starts = healingNode(t, "alive\nrestarting\n")
	if status, body := get(); status != http.StatusBadGateway || !strings.Contains(body, "isn't running") {
		t.Fatalf("crashing: %d %q", status, body)
	}
	time.Sleep(300 * time.Millisecond)
	if starts() != 0 {
		t.Fatal("a crashing app was started again")
	}
}

// A stopped app (its owner pressed Stop) stays stopped, whatever the visitor does.
func TestAStoppedAppIsNotHealed(t *testing.T) {
	s, get, starts := healingNode(t, "")
	s.previews["ws1"].Stopped = true
	if status, _ := get(); status != http.StatusServiceUnavailable {
		t.Fatalf("%d", status)
	}
	time.Sleep(200 * time.Millisecond)
	if starts() != 0 {
		t.Fatal("a stopped app was started")
	}
}
