package sandbox

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestToolsGatewaySwapsTheCapability puts a fake MCP server behind /mcp: the
// sandbox's capability goes no further than the node, the session's own
// headers and the MCP session id reach the server, and a stream arrives whole.
func TestToolsGatewaySwapsTheCapability(t *testing.T) {
	var seen http.Header
	var path, query string
	mcp := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, path, query = r.Header.Clone(), r.URL.Path, r.URL.RawQuery
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Mcp-Session-Id", "sess-1")
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\n", body)
	}))
	defer mcp.Close()

	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	space := &workspace{id: "ws1", capability: "cap-123", tools: ToolsAuth{URL: mcp.URL + "/tool_router/trs_1/mcp?x=1", Headers: map[string]string{"x-api-key": "real-key"}}}
	s.spaces["ws1"], s.byCapability["cap-123"] = space, space
	gateway := httptest.NewServer(s.GatewayHandler())
	defer gateway.Close()

	request, _ := http.NewRequest("POST", gateway.URL+"/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`))
	request.Header.Set("Authorization", "Bearer cap-123")
	request.Header.Set("Mcp-Session-Id", "sess-1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 200 || !strings.Contains(string(body), "tools/list") {
		t.Fatalf("%d %s", response.StatusCode, body)
	}
	if response.Header.Get("Mcp-Session-Id") != "sess-1" {
		t.Error("the MCP session id must come back to the sandbox")
	}
	if seen.Get("X-Api-Key") != "real-key" || seen.Get("Authorization") != "" {
		t.Errorf("upstream headers: key %q, authorization %q", seen.Get("X-Api-Key"), seen.Get("Authorization"))
	}
	if seen.Get("Mcp-Session-Id") != "sess-1" {
		t.Error("the MCP session id must reach the server")
	}
	if path != "/tool_router/trs_1/mcp" || query != "x=1" {
		t.Errorf("upstream address: %s?%s", path, query)
	}

	for _, token := range []string{"", "wrong"} {
		request, _ := http.NewRequest("POST", gateway.URL+"/mcp", strings.NewReader("{}"))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 401 {
			t.Errorf("token %q: %d, want 401", token, response.StatusCode)
		}
	}

	space.tools = ToolsAuth{}
	request, _ = http.NewRequest("POST", gateway.URL+"/mcp", strings.NewReader("{}"))
	request.Header.Set("Authorization", "Bearer cap-123")
	if response, _ := http.DefaultClient.Do(request); response.StatusCode != 404 {
		t.Errorf("no tools: %d, want 404", response.StatusCode)
	}
}

func TestMCPConfigHoldsOnlyTheCapability(t *testing.T) {
	raw := mcpConfig("http://172.30.0.1:7481", "cap-123")
	var config struct {
		MCPServers map[string]struct {
			Type, URL string
			Headers   map[string]string
		} `json:"mcpServers"`
	}
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatal(err)
	}
	server := config.MCPServers["composio"]
	if server.Type != "http" || server.URL != "http://172.30.0.1:7481/mcp" || server.Headers["Authorization"] != "Bearer cap-123" {
		t.Fatalf("%+v", server)
	}
	if !strings.Contains(DefaultAgent, `--mcp-config "$KIMONO_MCP"`) {
		t.Fatal("the agent must load the tools when there are some")
	}
}

func TestEnvironmentAddsToolsOnlyWhenThereAreSome(t *testing.T) {
	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	s.gatewayURL = "http://gw:7481"
	w := &workspace{id: "ws1", capability: "cap"}
	for _, line := range s.environment(w) {
		if strings.HasPrefix(line, "KIMONO_MCP=") {
			t.Fatal("no tools, yet KIMONO_MCP is set")
		}
	}
	w.tools = ToolsAuth{URL: "https://backend.composio.dev/x", Headers: map[string]string{"x-api-key": "secret"}}
	found := false
	for _, line := range s.environment(w) {
		if strings.Contains(line, "secret") {
			t.Fatal("the tools key must never enter the sandbox")
		}
		found = found || strings.HasPrefix(line, "KIMONO_MCP=")
	}
	if !found {
		t.Fatal("tools are connected, yet KIMONO_MCP is missing")
	}
}

// Artifacts render in the chat while they are written: the agent streams its
// partial messages, and is told where artifacts go and how to read about them.
func TestAgentStreamsAndKnowsArtifacts(t *testing.T) {
	if !strings.Contains(DefaultAgent, "--include-partial-messages") {
		t.Fatal("the agent must stream partial messages, or artifacts only appear once finished")
	}
	for _, want := range []string{"/workspace/artifacts/<name>.html", "/opt/kimono/artifacts.md", "kimono-show <name>", "kimono-send <file>", "no network", "kimono-fetch <link>", "kimono-progress --wait", "even when they say \"video\"", "kimono-say \"<text>\"", "ElevenLabs only for", "kimono-link <file>", "COMPOSIO_SEARCH_TOOLS", "without having searched"} {
		if !strings.Contains(SystemPrompt, want) {
			t.Fatalf("the system prompt doesn't mention %q", want)
		}
	}
}

// kimono-link's base reaches the sandbox only as a plain http(s) address.
func TestLinksBase(t *testing.T) {
	for raw, want := range map[string]string{
		"https://kimono.example/api/v1/code/temp/abc/": "https://kimono.example/api/v1/code/temp/abc",
		"http://localhost:3000/api/v1/code/temp/abc":   "http://localhost:3000/api/v1/code/temp/abc",
		"":                        "",
		"file:///etc/passwd":      "",
		"https://x.example/$(id)": "",
		"https://x.example/a b":   "",
	} {
		if got := linksBase(raw); got != want {
			t.Fatalf("linksBase(%q) = %q, want %q", raw, got, want)
		}
	}
}

// Only projects publish apps: a chat's prompt never tells it how.
func TestAppsAreForProjects(t *testing.T) {
	if strings.Contains(SystemPrompt, "kimono-serve <port>") {
		t.Fatal("the shared system prompt must not teach kimono-serve; AppPrompt does, in projects")
	}
	if !strings.Contains(AppPrompt, "kimono-serve <port>") {
		t.Fatal("AppPrompt must teach kimono-serve")
	}
}
