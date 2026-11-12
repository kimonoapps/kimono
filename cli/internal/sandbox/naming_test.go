package sandbox

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Between turns a sandbox gets nothing from the model, except the one-off key a
// chat is named with, and only while that naming runs.
func TestModelBetweenTurnsOnlyForNaming(t *testing.T) {
	var reached int
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached++
		if got := r.Header.Get("X-Api-Key"); got != "sk-real" {
			t.Errorf("upstream got credential %q, want the real one", got)
		}
		w.WriteHeader(200)
	}))
	defer upstream.Close()

	space := &workspace{id: "chat", capability: "cap", model: ModelAuth{Token: "sk-real"}}
	s := &Server{cfg: Config{AnthropicUpstream: upstream.URL}, byCapability: map[string]*workspace{"cap": space}, naming: map[string]*workspace{}}
	ask := func(key string) int {
		r := httptest.NewRequest("POST", "/anthropic/v1/messages", nil)
		r.Header.Set("X-Api-Key", key)
		w := httptest.NewRecorder()
		s.serveModel(w, r)
		return w.Code
	}

	if code := ask("cap"); code != 409 {
		t.Fatalf("the sandbox's own key between turns: %d, want 409", code)
	}
	s.naming["once"] = space
	if code := ask("once"); code != 200 {
		t.Fatalf("the naming key while it names: %d, want 200", code)
	}
	if code := ask("cap"); code != 409 {
		t.Fatalf("the sandbox's own key while it's being named: %d, want 409", code)
	}
	delete(s.naming, "once")
	if code := ask("once"); code != 401 {
		t.Fatalf("the naming key after: %d, want 401", code)
	}
	if reached != 1 {
		t.Fatalf("upstream reached %d times, want 1", reached)
	}
}
