package sandbox

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestScriptureRefusesStrangers(t *testing.T) {
	s, _ := New(Config{Key: "k", StateDir: t.TempDir()})
	space := &workspace{id: "ws1", capability: "cap-s"}
	s.spaces["ws1"], s.byCapability["cap-s"] = space, space
	for _, c := range []struct {
		path, token string
		want        int
	}{
		{"/scripture/quran/verses/by_key/1:1", "", 401},
		{"/scripture/web/anything", "cap-s", 404},
		{"/scripture/quran/../../etc", "cap-s", 307}, /* the mux cleans it away first */
		{"/scripture/hadith/a//b", "cap-s", 307},
		{"/scripture/hadith/a%20b", "cap-s", 404},
	} {
		r := httptest.NewRequest("GET", c.path, nil)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		w := httptest.NewRecorder()
		s.GatewayHandler().ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s: %d, want %d", c.path, w.Code, c.want)
		}
	}
	r := httptest.NewRequest("POST", "/scripture/quran/chapters/1", nil)
	r.Header.Set("Authorization", "Bearer cap-s")
	w := httptest.NewRecorder()
	s.GatewayHandler().ServeHTTP(w, r)
	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", w.Code)
	}
}
