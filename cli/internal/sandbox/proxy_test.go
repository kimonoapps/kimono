package sandbox

import (
	"bufio"
	"context"
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

// TestPreviewProxyCarriesALiveApp puts a real server behind a preview link:
// a page, a stream that arrives as it is written, a WebSocket, and the link
// of an app its owner stopped.
func TestPreviewProxyCarriesALiveApp(t *testing.T) {
	second := make(chan struct{})
	app := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/hello":
			fmt.Fprintf(w, "hello from %s", r.Host)
		case "/events":
			// Streamed rendering: chunks of HTML that must not wait for the end.
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, "data: one\n\n")
			w.(http.Flusher).Flush()
			<-second
			fmt.Fprint(w, "data: two\n\n")
		case "/ws":
			conn, buffered, err := w.(http.Hijacker).Hijack()
			if err != nil {
				return
			}
			defer conn.Close()
			fmt.Fprint(buffered, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
			_ = buffered.Flush()
			line, _ := buffered.ReadString('\n')
			fmt.Fprint(buffered, "echo "+line)
			_ = buffered.Flush()
		}
	}))
	defer app.Close()

	// Docker says the sandbox is up; the dial goes straight to the app.
	fake := filepath.Join(t.TempDir(), "docker")
	if err := os.WriteFile(fake, []byte("#!/bin/sh\necho running\n"), 0755); err != nil {
		t.Fatal(err)
	}
	s, _ := New(Config{Key: "k", StateDir: t.TempDir(), Docker: fake})
	s.docker = docker{bin: fake}
	dialed := 0
	s.dial = func(ctx context.Context, _ string, _ int) (net.Conn, error) {
		dialed++
		return (&net.Dialer{}).DialContext(ctx, "tcp", app.Listener.Addr().String())
	}
	s.previews["ws1"] = &preview{Name: "chat-abc123", Port: 3000, Args: []string{"node", "server.js"}}
	front := httptest.NewServer(s.PreviewHandler())
	defer front.Close()
	get := func(path string) *http.Response {
		request, _ := http.NewRequest("GET", front.URL+path, nil)
		request.Host = "chat-abc123.localhost:7482"
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}

	response := get("/api/hello")
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || string(body) != "hello from localhost:3000" {
		t.Fatalf("api: %d %q", response.StatusCode, body)
	}

	response = get("/events")
	reader := bufio.NewReader(response.Body)
	first := make(chan string, 1)
	go func() { line, _ := reader.ReadString('\n'); first <- line }()
	select {
	case line := <-first:
		if line != "data: one\n" {
			t.Fatalf("stream: %q", line)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("the stream's first event was held back")
	}
	close(second)
	response.Body.Close()

	conn, err := net.Dial("tcp", front.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprint(conn, "GET /ws HTTP/1.1\r\nHost: chat-abc123.localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	upgraded := bufio.NewReader(conn)
	status, _ := upgraded.ReadString('\n')
	if !strings.Contains(status, "101") {
		t.Fatalf("upgrade: %q", status)
	}
	for line, _ := upgraded.ReadString('\n'); line != "\r\n" && line != ""; line, _ = upgraded.ReadString('\n') {
	}
	fmt.Fprint(conn, "ping\n")
	if echoed, _ := upgraded.ReadString('\n'); echoed != "echo ping\n" {
		t.Fatalf("websocket: %q", echoed)
	}

	s.setStopped("ws1", true)
	before := dialed
	response = get("/")
	body, _ = io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(body), "isn't running") || dialed != before {
		t.Fatalf("stopped app: %d, dialed %d times", response.StatusCode, dialed-before)
	}
}
