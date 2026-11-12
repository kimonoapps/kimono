package sandbox

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// A stand-in for a Composio tool session: MCP over HTTP, answering
// COMPOSIO_MULTI_EXECUTE_TOOL with one Tavily result per query.
func fakeToolSession(t *testing.T, calls *atomic.Int32) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Api-Key") != "ck-test" {
			w.WriteHeader(401)
			return
		}
		var message struct {
			ID     any             `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &message)
		switch message.Method {
		case "initialize":
			w.Header().Set("Mcp-Session-Id", "s1")
			_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": message.ID, "result": map[string]any{"protocolVersion": "2025-03-26"}})
		case "notifications/initialized":
			w.WriteHeader(202)
		case "tools/call":
			if r.Header.Get("Mcp-Session-Id") != "s1" {
				w.WriteHeader(404)
				return
			}
			calls.Add(1)
			var params struct {
				Name      string `json:"name"`
				Arguments struct {
					Tools []struct {
						Slug      string         `json:"tool_slug"`
						Arguments map[string]any `json:"arguments"`
					} `json:"tools"`
				} `json:"arguments"`
			}
			_ = json.Unmarshal(message.Params, &params)
			results := []any{}
			for _, tool := range params.Arguments.Tools {
				if tool.Slug != "TAVILY_SEARCH" {
					t.Errorf("ran %s", tool.Slug)
				}
				results = append(results, map[string]any{"response": map[string]any{"successful": true, "data": map[string]any{"results": []map[string]string{{"title": fmt.Sprint("About ", tool.Arguments["query"]), "url": "https://example.com", "content": "a passage"}}}}})
			}
			text, _ := json.Marshal(map[string]any{"successful": true, "data": map[string]any{"results": results}})
			w.Header().Set("Content-Type", "text/event-stream")
			payload, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": message.ID, "result": map[string]any{"content": []map[string]string{{"type": "text", "text": string(text)}}}})
			fmt.Fprintf(w, "event: message\ndata: %s\n\n", payload)
		}
	}))
}

func TestSearchRunsTavilyThroughTheToolSession(t *testing.T) {
	var calls atomic.Int32
	upstream := fakeToolSession(t, &calls)
	defer upstream.Close()

	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	space := &workspace{id: "ws1", capability: "cap-s", tools: ToolsAuth{URL: upstream.URL, Headers: map[string]string{"x-api-key": "ck-test"}}, busy: true}
	s.spaces["ws1"], s.byCapability["cap-s"] = space, space
	bare := &workspace{id: "ws2", capability: "cap-b", busy: true}
	s.spaces["ws2"], s.byCapability["cap-b"] = bare, bare

	ask := func(token, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/search", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		s.GatewayHandler().ServeHTTP(w, r)
		return w
	}
	if w := ask("nobody", `{"queries":["x"]}`); w.Code != 401 {
		t.Fatalf("a stranger: %d", w.Code)
	}
	if w := ask("cap-b", `{"queries":["x"]}`); w.Code != 404 || !strings.Contains(w.Body.String(), "WebSearch") {
		t.Fatalf("no tool session: %d %s", w.Code, w.Body)
	}
	if w := ask("cap-s", `{"queries":["  "]}`); w.Code != 400 {
		t.Fatalf("no query: %d", w.Code)
	}
	for round := 0; round < 2; round++ {
		w := ask("cap-s", `{"queries":["iphone 17 pro price canada","pixel 10 pro price canada","galaxy s26 ultra price canada"]}`)
		if w.Code != 200 {
			t.Fatalf("search: %d %s", w.Code, w.Body)
		}
		var got struct {
			Results []searchAnswer `json:"results"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &got)
		if len(got.Results) != 3 || got.Results[1].Query != "pixel 10 pro price canada" || len(got.Results[1].Results) != 1 || got.Results[1].Results[0].Title != "About pixel 10 pro price canada" {
			t.Errorf("results: %+v", got.Results)
		}
	}
	if calls.Load() != 2 {
		t.Errorf("%d tool calls for two searches of three queries: they should go as one call each", calls.Load())
	}
}
