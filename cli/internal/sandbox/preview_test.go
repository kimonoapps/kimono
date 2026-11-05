package sandbox

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestPreviewName(t *testing.T) {
	for branch, stem := range map[string]string{
		"code/add-a-notesmd-explaining-what-f461": "add-a-notesmd-",
		"code/fix-login-3fa2":                     "fix-login-",
		"main":                                    "main-",
		"code/---":                                "preview-",
		"code/Ünïcode-only-ab12":                  "n-code-only-",
	} {
		name := previewName(branch)
		if !strings.HasPrefix(name, stem) || len(name) != len(stem)+6 || !previewNamePattern.MatchString(name) {
			t.Errorf("previewName(%q) = %q, want %s + 6 hex", branch, name, stem)
		}
	}
	if previewName("code/a-b") == previewName("code/a-b") {
		t.Error("two previews of one branch got the same name")
	}
}

func TestPreviewLabel(t *testing.T) {
	for host, want := range map[string]string{
		"notes-app-3fa2c1.example.dev":     "notes-app-3fa2c1",
		"Notes-App-3FA2C1.Example.Dev.":    "notes-app-3fa2c1",
		"notes-app-3fa2c1.localhost:7482":  "notes-app-3fa2c1",
		"notes-app-3fa2c1.example.dev:443": "notes-app-3fa2c1",
	} {
		if got, ok := previewLabel(host, "example.dev"); !ok || got != want {
			t.Errorf("previewLabel(%q) = %q, %v; want %q", host, got, ok, want)
		}
	}
	for _, host := range []string{"example.dev", "a.b.example.dev", "evil.dev", "x.example.dev.evil.com", "-x.example.dev", "localhost:7482", "a_b.localhost"} {
		if got, ok := previewLabel(host, "example.dev"); ok {
			t.Errorf("previewLabel(%q) = %q, accepted", host, got)
		}
	}
	if _, ok := previewLabel("x.example.dev", ""); ok {
		t.Error("a domain was accepted with no preview domain set")
	}
}

func TestShotNames(t *testing.T) {
	for _, ok := range []string{"1730700000000-home.png", "a.jpg", "b.jpeg", "c.webp", "X_y-1.PNG.png"} {
		if !validShotName(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", ".hidden.png", "../x.png", "a/b.png", "a.txt", "a.svg", "a..png", "a png.png", "a.png\n"} {
		if validShotName(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestParseOutbox(t *testing.T) {
	out := "shot 2-b.png\nshot 1-a.png\nshot 1-a.txt\nshot ../x.png\nserve {\"port\":3000,\"pid\":42,\"command\":[\"python3\",\"-m\",\"http.server\",\"3000\"]}\n"
	box := parseOutbox([]byte(out))
	if !reflect.DeepEqual(box.shots, []string{"1-a.png", "2-b.png"}) {
		t.Errorf("shots %v", box.shots)
	}
	if box.serve == nil || box.serve.Port != 3000 || !reflect.DeepEqual(box.serve.Command, []string{"python3", "-m", "http.server", "3000"}) {
		t.Errorf("serve %+v", box.serve)
	}
	if !parseOutbox([]byte("restarting\n")).restarting {
		t.Error("a restart in progress wasn't noticed")
	}
	if parseOutbox([]byte("serve {\"port\":70000}\n")).serve != nil {
		t.Error("an impossible port was accepted")
	}
	if box := parseOutbox(nil); box.serve != nil || len(box.shots) != 0 {
		t.Errorf("empty outbox read as %+v", box)
	}
}

func TestPreviewTable(t *testing.T) {
	s, err := New(Config{Key: "k", StateDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	p, changed := s.setPreview("ws1", 3000, []string{"npm", "start"}, "code/notes-app-3fa2")
	if !changed || !strings.HasPrefix(p.Name, "notes-app-") {
		t.Fatalf("new preview %+v, %v", p, changed)
	}
	if again, changed := s.setPreview("ws1", 3000, []string{"npm", "start"}, "code/notes-app-3fa2"); changed || again.Name != p.Name {
		t.Errorf("same preview reported as changed: %+v", again)
	}
	if moved, changed := s.setPreview("ws1", 5173, nil, "code/notes-app-3fa2"); !changed || moved.Name != p.Name {
		t.Errorf("a new port should keep the name and report a change: %+v %v", moved, changed)
	}
	if url := s.previewURL(p); url != "http://"+p.Name+".localhost:7482" {
		t.Errorf("dev url %s", url)
	}
	// What a restart reads back.
	reloaded, _ := New(Config{Key: "k", StateDir: s.cfg.StateDir, PreviewDomain: "Example.Dev."})
	if got := reloaded.previews["ws1"]; got == nil || got.Name != p.Name || got.Port != 5173 {
		t.Fatalf("reloaded %+v", got)
	}
	if url := reloaded.previewURL(reloaded.previews["ws1"]); url != "https://"+p.Name+".example.dev" {
		t.Errorf("domain url %s", url)
	}
	if !s.clearPreview("ws1") || s.clearPreview("ws1") {
		t.Error("clearPreview should report only the first removal")
	}
}

func TestPreviewProxyUnknownHost(t *testing.T) {
	s, _ := New(Config{Key: "k", StateDir: t.TempDir(), PreviewDomain: "example.dev"})
	for _, host := range []string{"nothing-here-abcdef.example.dev", "example.dev", "evil.com"} {
		request := httptest.NewRequest("GET", "http://"+host+"/", nil)
		recorder := httptest.NewRecorder()
		s.PreviewHandler().ServeHTTP(recorder, request)
		if recorder.Code != http.StatusNotFound || !strings.Contains(recorder.Body.String(), "isn't running") {
			t.Errorf("%s: %d %q", host, recorder.Code, recorder.Body.String())
		}
	}
}

func TestAnAppCanBeGivenAChosenName(t *testing.T) {
	s := &Server{previews: map[string]*preview{"a": {Name: "make-a-simple-2f827d", Port: 3000}, "b": {Name: "recipes", Port: 3000}}, cfg: Config{StateDir: t.TempDir()}}
	if _, err := s.renamePreview("a", "Family-Kitchen"); err != nil {
		t.Fatal(err)
	}
	if s.previews["a"].Name != "family-kitchen" {
		t.Fatalf("got %q", s.previews["a"].Name)
	}
	for _, bad := range []string{"recipes", "www", "-x", "a--b", "has space", "x.y", ""} {
		if _, err := s.renamePreview("a", bad); err == nil {
			t.Fatalf("%q should be refused", bad)
		}
	}
	if _, err := s.renamePreview("none", "fresh"); err == nil {
		t.Fatal("a workspace with no app has nothing to name")
	}
}
