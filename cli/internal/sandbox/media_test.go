package sandbox

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestMediaComesInOnlyFromToolLinks: a link in a tool result can be fetched
// through /media, once, as media; a link no tool gave back, or one that isn't
// a picture, a sound or a video, can't.
func TestMediaComesInOnlyFromToolLinks(t *testing.T) {
	store := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/out/voice.mp3":
			w.Header().Set("Content-Type", "application/octet-stream")
			fmt.Fprint(w, "ID3-sound")
		case "/out/page.html":
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, "<html>")
		default:
			http.NotFound(w, r)
		}
	}))
	defer store.Close()
	voice := store.URL + "/out/voice.mp3?X-Amz-Signature=abc&X-Amz-Expires=3600"
	page := store.URL + "/out/page.html"
	/* The result as Composio's MCP sends it: JSON text inside the message's JSON. */
	escaped := strings.ReplaceAll(voice, "&", `\\u0026`)
	mcp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, `data: {"result":{"content":[{"type":"text","text":"{\"data\":{\"file\":{\"s3url\":\"%s\"}},\"page\":\"%s\"}"}]}}`+"\n\n", escaped, page)
	}))
	defer mcp.Close()

	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	s.mediaClient = store.Client()
	space := &workspace{id: "ws1", capability: "cap-1", tools: ToolsAuth{URL: mcp.URL + "/mcp"}}
	s.spaces["ws1"], s.byCapability["cap-1"] = space, space
	gateway := httptest.NewServer(s.GatewayHandler())
	defer gateway.Close()

	fetch := func(link, token string) (*http.Response, string) {
		request, _ := http.NewRequest("GET", gateway.URL+"/media?link="+urlQuery(link), nil)
		request.Header.Set("Authorization", "Bearer "+token)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(response.Body)
		response.Body.Close()
		return response, string(body)
	}

	if response, _ := fetch(voice, "cap-1"); response.StatusCode != 403 {
		t.Fatalf("before any tool gave it back: %d, want 403", response.StatusCode)
	}
	request, _ := http.NewRequest("POST", gateway.URL+"/mcp", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer cap-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	io.ReadAll(response.Body)
	response.Body.Close()

	response, body := fetch(voice, "cap-1")
	if response.StatusCode != 200 || body != "ID3-sound" || response.Header.Get("X-Kimono-Name") != "voice.mp3" {
		t.Fatalf("a tool's link: %d %q name %q", response.StatusCode, body, response.Header.Get("X-Kimono-Name"))
	}
	if response, _ := fetch(page, "cap-1"); response.StatusCode != 415 {
		t.Errorf("a web page a tool linked to: %d, want 415", response.StatusCode)
	}
	if response, _ := fetch(store.URL+"/out/other.mp3", "cap-1"); response.StatusCode != 403 {
		t.Errorf("a link no tool gave back: %d, want 403", response.StatusCode)
	}
	if response, _ := fetch(voice, "someone-else"); response.StatusCode != 401 {
		t.Errorf("another capability: %d, want 401", response.StatusCode)
	}
}

func urlQuery(s string) string {
	return strings.NewReplacer("%", "%25", "&", "%26", "?", "%3F", "=", "%3D", "+", "%2B", "#", "%23").Replace(s)
}

func TestLinksFromToolResultsAreUnescaped(t *testing.T) {
	cases := map[string]string{
		`https://s3.example.com/a.mp3?x=1\\u0026y=2\"}`: "https://s3.example.com/a.mp3?x=1&y=2",
		`https:\/\/cdn.example.com\/v.mp4&z=3\",`:       "",
		`https://cdn.example.com/v.mp4?a=b&c=d\"`:       "https://cdn.example.com/v.mp4?a=b&c=d",
		`https://example.com/clip.mp4).`:                "https://example.com/clip.mp4",
	}
	for raw, want := range cases {
		found := linkPattern.FindString(raw)
		if want == "" {
			continue // escaped slashes don't start a link; Composio doesn't send them
		}
		if got := cleanLink(found); got != want {
			t.Errorf("%s: %q, want %q", raw, got, want)
		}
	}
}

func TestMediaReachesOnlyThePublicInternet(t *testing.T) {
	for _, address := range []string{"127.0.0.1:443", "10.1.2.3:443", "192.168.1.1:443", "172.30.0.1:7481", "169.254.169.254:80", "100.101.102.103:443", "[::1]:443", "[fd00::1]:443", "0.0.0.0:443"} {
		if publicOnly("tcp", address, nil) == nil {
			t.Errorf("%s was allowed", address)
		}
	}
	for _, address := range []string{"52.216.1.1:443", "[2606:4700::1111]:443"} {
		if err := publicOnly("tcp", address, nil); err != nil {
			t.Errorf("%s: %v", address, err)
		}
	}
}

func TestMediaKinds(t *testing.T) {
	for _, c := range []struct {
		kind, name string
		want       bool
	}{
		{"audio/mpeg", "x", true}, {"video/mp4", "x", true}, {"image/png", "x", true}, {"image/svg+xml", "a.svg", false},
		{"application/octet-stream", "voice.mp3", true}, {"binary/octet-stream", "v.MP4", true}, {"application/octet-stream", "a.sh", false},
		{"text/html", "a.mp3", false}, {"application/json", "x", false},
	} {
		if got := isMedia(c.kind, c.name); got != c.want {
			t.Errorf("%s %s: %v", c.kind, c.name, got)
		}
	}
}

func TestEnvironmentTellsFetchWhereTheGatewayIs(t *testing.T) {
	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	s.gatewayURL = "http://gw:7481"
	env := strings.Join(s.environment(&workspace{id: "ws1", capability: "cap", tools: ToolsAuth{URL: "https://backend.composio.dev/x"}}), "\n")
	if !strings.Contains(env, "KIMONO_GATEWAY=http://gw:7481") || !strings.Contains(env, "KIMONO_TOKEN=cap") {
		t.Fatal(env)
	}
	if env := strings.Join(s.environment(&workspace{id: "ws1", capability: "cap"}), "\n"); strings.Contains(env, "KIMONO_GATEWAY") {
		t.Fatal("no tools, no media to fetch")
	}
}
