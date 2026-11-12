package sandbox

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestSearchAsksEveryQueryAtOnce(t *testing.T) {
	var asked atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tvly-test" {
			w.WriteHeader(401)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		asked.Add(1)
		time.Sleep(300 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{"results": []map[string]string{{"title": "About " + body["query"].(string), "url": "https://example.com", "content": "a passage"}}})
	}))
	defer upstream.Close()
	was := searchUpstream
	searchUpstream = upstream.URL
	defer func() { searchUpstream = was }()

	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	space := &workspace{id: "ws1", capability: "cap-s", search: SearchAuth{Key: "tvly-test"}, busy: true}
	s.spaces["ws1"], s.byCapability["cap-s"] = space, space
	idle := &workspace{id: "ws2", capability: "cap-i"}
	s.spaces["ws2"], s.byCapability["cap-i"] = idle, idle

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
	if w := ask("cap-i", `{"queries":["x"]}`); w.Code != 404 {
		t.Fatalf("no key: %d", w.Code)
	}
	if w := ask("cap-s", `{"queries":["  "]}`); w.Code != 400 {
		t.Fatalf("no query: %d", w.Code)
	}
	start := time.Now()
	w := ask("cap-s", `{"queries":["iphone 17 pro price canada","pixel 10 pro price canada","galaxy s26 ultra price canada"]}`)
	if w.Code != 200 {
		t.Fatalf("search: %d %s", w.Code, w.Body)
	}
	if took := time.Since(start); took > 800*time.Millisecond {
		t.Errorf("three searches took %s: they should run side by side", took)
	}
	var got struct {
		Results []searchAnswer `json:"results"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &got)
	if len(got.Results) != 3 || got.Results[1].Query != "pixel 10 pro price canada" || len(got.Results[1].Results) != 1 || asked.Load() != 3 {
		t.Errorf("results: %+v (asked %d)", got.Results, asked.Load())
	}
}
