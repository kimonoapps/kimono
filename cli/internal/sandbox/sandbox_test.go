package sandbox

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestCleanPath(t *testing.T) {
	for raw, want := range map[string]string{"": "", ".": "", "src": "src", "src/./a.go": "src/a.go", "a//b/": "a/b", ".gitignore": ".gitignore", ".github/x": ".github/x"} {
		if got, ok := cleanPath(raw); !ok || got != want {
			t.Errorf("cleanPath(%q) = %q, %v; want %q", raw, got, ok, want)
		}
	}
	for _, raw := range []string{"..", "../etc", "a/../../b", "a/..", "/etc/passwd", ".git", ".git/config", "./.git/HEAD", "a\x00b"} {
		if got, ok := cleanPath(raw); ok {
			t.Errorf("cleanPath(%q) = %q, accepted", raw, got)
		}
	}
}

func TestValidBranch(t *testing.T) {
	for _, ok := range []string{"main", "code/fix-login-3fa2", "release-1.2"} {
		if !validBranch(ok) {
			t.Errorf("%q refused", ok)
		}
	}
	for _, bad := range []string{"", "-x", "/a", "a/", "a..b", "a//b", "a.lock", "a/.b", "a b", "a~1", "HEAD@{1}"} {
		if validBranch(bad) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestRepoBase(t *testing.T) {
	repo := Repo{URL: "https://git.example.com/akram/kimono.git", Owner: "akram", Name: "kimono", Base: "main", Branch: "code/x"}
	if base, err := repoBase(repo, false); err != nil || base != "https://git.example.com" {
		t.Fatalf("base %q, %v", base, err)
	}
	repo.URL = "https://example.com/forgejo/akram/kimono"
	if base, err := repoBase(repo, false); err != nil || base != "https://example.com/forgejo" {
		t.Fatalf("prefixed base %q, %v", base, err)
	}
	for _, address := range []string{"http://git.example.com/akram/kimono.git", "https://u:p@git.example.com/akram/kimono.git", "https://git.example.com/other/kimono.git", "file:///srv/akram/kimono.git", "http://dev.git/akram/kimono.git"} {
		repo.URL = address
		if _, err := repoBase(repo, false); err == nil {
			t.Errorf("%s accepted", address)
		}
	}
	repo.URL = "http://dev.git/akram/kimono.git"
	if base, err := repoBase(repo, true); err != nil || base != "http://dev.git" {
		t.Errorf("dev base %q, %v", base, err)
	}
}

func TestSwapModelCredential(t *testing.T) {
	header := http.Header{}
	header.Set("X-Api-Key", "kimono-sbx-capability")
	swapModelCredential(header, "sk-ant-api03-real")
	if header.Get("X-Api-Key") != "sk-ant-api03-real" || header.Get("Authorization") != "" {
		t.Fatalf("api key: %v", header)
	}

	header = http.Header{}
	header.Set("X-Api-Key", "kimono-sbx-capability")
	header.Add("Anthropic-Beta", "prompt-caching-2024-07-31, oauth-2025-04-20")
	header.Add("Anthropic-Beta", "fine-grained-tool-streaming-2025-05-14")
	swapModelCredential(header, "sk-ant-oat01-real")
	if header.Get("X-Api-Key") != "" || header.Get("Authorization") != "Bearer sk-ant-oat01-real" {
		t.Fatalf("oauth: %v", header)
	}
	if got := header.Values("Anthropic-Beta"); !reflect.DeepEqual(got, []string{"prompt-caching-2024-07-31,fine-grained-tool-streaming-2025-05-14,oauth-2025-04-20"}) {
		t.Fatalf("betas %v", got)
	}
}

func TestGitAllowed(t *testing.T) {
	repo := Repo{Owner: "akram", Name: "kimono", Branch: "code/x"}
	cases := []struct {
		method, rest, service string
		push, ok              bool
	}{
		{"GET", "akram/kimono.git/info/refs", "git-upload-pack", false, true},
		{"GET", "Akram/Kimono/info/refs", "git-receive-pack", true, true},
		{"POST", "akram/kimono.git/git-upload-pack", "", false, true},
		{"POST", "akram/kimono.git/git-receive-pack", "", true, true},
		{"GET", "akram/kimono.git/info/refs", "", false, false},
		{"GET", "akram/other.git/info/refs", "git-upload-pack", false, false},
		{"GET", "akram/kimono.git/HEAD", "", false, false},
		{"GET", "akram/kimono.git/git-upload-pack", "", false, false},
		{"GET", "api/v1/repos/akram/kimono", "", false, false},
		{"POST", "akram/kimono.git/info/lfs/objects/batch", "", false, false},
		{"GET", "akram/kimono.git/../../admin/info/refs", "git-upload-pack", false, false},
	}
	for _, c := range cases {
		push, ok := gitAllowed(c.method, c.rest, c.service, repo)
		if push != c.push || ok != c.ok {
			t.Errorf("%s %s %s = %v %v; want %v %v", c.method, c.rest, c.service, push, ok, c.push, c.ok)
		}
	}
}

func pkt(line string) string { return fmt.Sprintf("%04x%s", len(line)+4, line) }

func TestPushedRefs(t *testing.T) {
	zero := strings.Repeat("0", 40)
	one := strings.Repeat("1", 40)
	body := pkt(zero+" "+one+" refs/heads/code/x\x00report-status side-band-64k\n") + pkt("shallow "+one+"\n") + "0000" + "PACKdata"
	reader := bufio.NewReader(strings.NewReader(body))
	refs, consumed, err := pushedRefs(reader)
	if err != nil || !reflect.DeepEqual(refs, []string{"refs/heads/code/x"}) {
		t.Fatalf("refs %v, %v", refs, err)
	}
	rest, _ := io.ReadAll(reader)
	if string(consumed)+string(rest) != body {
		t.Fatalf("body not preserved")
	}
	if _, _, err := pushedRefs(bufio.NewReader(strings.NewReader("zzzz"))); err == nil {
		t.Fatal("malformed accepted")
	}
}

func TestBrokerRefusesOtherBranches(t *testing.T) {
	server, _ := New(Config{Key: "k"})
	space := &workspace{id: "w", capability: "cap", repo: Repo{Owner: "akram", Name: "kimono", Branch: "code/x"}, base: "https://git.invalid"}
	server.spaces["w"], server.byCapability["cap"] = space, space
	zero := strings.Repeat("0", 40)
	body := pkt(zero+" "+zero+" refs/heads/main\x00report-status\n") + "0000"
	request := httptest.NewRequest("POST", "/git/akram/kimono.git/git-receive-pack", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer cap")
	recorder := httptest.NewRecorder()
	server.GatewayHandler().ServeHTTP(recorder, request)
	if recorder.Code != 403 {
		t.Fatalf("push to main: %d %s", recorder.Code, recorder.Body)
	}
	request = httptest.NewRequest("GET", "/git/akram/kimono.git/info/refs?service=git-upload-pack", nil)
	request.Header.Set("Authorization", "Bearer nope")
	recorder = httptest.NewRecorder()
	server.GatewayHandler().ServeHTTP(recorder, request)
	if recorder.Code != 401 {
		t.Fatalf("unknown capability: %d", recorder.Code)
	}
}

func TestModelGatewaySwapsCapability(t *testing.T) {
	var seen http.Header
	var path string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen, path = r.Header.Clone(), r.URL.Path
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer upstream.Close()
	server, _ := New(Config{Key: "k", AnthropicUpstream: upstream.URL})
	space := &workspace{id: "w", capability: "cap", model: ModelAuth{Token: "sk-ant-api03-real"}}
	server.spaces["w"], server.byCapability["cap"] = space, space
	request := httptest.NewRequest("POST", "/anthropic/v1/messages", strings.NewReader(`{}`))
	request.Header.Set("X-Api-Key", "cap")
	recorder := httptest.NewRecorder()
	server.GatewayHandler().ServeHTTP(recorder, request)
	if recorder.Code != 200 || path != "/v1/messages" || seen.Get("X-Api-Key") != "sk-ant-api03-real" {
		t.Fatalf("%d %s %v", recorder.Code, path, seen)
	}
}

func TestParseChanges(t *testing.T) {
	names := []byte("M\x00README.md\x00A\x00new.go\x00R087\x00old/a.go\x00new/a.go\x00D\x00gone.txt\x00")
	files := parseNameStatus(names)
	want := []changedFile{{Path: "README.md", Status: "modified"}, {Path: "new.go", Status: "added"}, {Path: "new/a.go", Status: "renamed"}, {Path: "gone.txt", Status: "deleted"}}
	if !reflect.DeepEqual(files, want) {
		t.Fatalf("name-status %+v", files)
	}
	counts := parseNumstat([]byte("3\t1\tREADME.md\x0010\t0\tnew.go\x002\t2\t\x00old/a.go\x00new/a.go\x00-\t-\timage.png\x00"))
	if counts["README.md"] != [2]int{3, 1} || counts["new.go"] != [2]int{10, 0} || counts["new/a.go"] != [2]int{2, 2} || counts["image.png"] != [2]int{0, 0} {
		t.Fatalf("numstat %v", counts)
	}
}

func TestParseListing(t *testing.T) {
	out := []byte("f\t12\tb.txt\x00d\t4096\tsrc\x00d\t4096\t.git\x00l\t7\tlink\x00f\t3\tA.md\x00")
	got := parseListing(out)
	want := []entry{{"src", "dir", 0}, {"A.md", "file", 3}, {"b.txt", "file", 12}, {"link", "link", 7}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%+v", got)
	}
}

func TestAttachments(t *testing.T) {
	prompt, err := withAttachments("fix it", []string{"/attachments/screen shot.png"})
	if err != nil || !strings.HasSuffix(prompt, "Attached files: /attachments/screen shot.png") {
		t.Fatalf("%q %v", prompt, err)
	}
	for _, bad := range []string{"/etc/passwd", "/attachments/../etc/passwd", "/attachments/.env", "attachments/a"} {
		if _, err := withAttachments("x", []string{bad}); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestAPIRequiresKey(t *testing.T) {
	server, _ := New(Config{Key: "secret"})
	for _, header := range []string{"", "Bearer wrong", "secret"} {
		request := httptest.NewRequest("GET", "/v1/health", nil)
		if header != "" {
			request.Header.Set("Authorization", header)
		}
		recorder := httptest.NewRecorder()
		server.Handler().ServeHTTP(recorder, request)
		if recorder.Code != 401 {
			t.Errorf("%q: %d", header, recorder.Code)
		}
	}
	request := httptest.NewRequest("GET", "/v1/health", nil)
	request.Header.Set("Authorization", "Bearer secret")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != 200 || !bytes.Contains(recorder.Body.Bytes(), []byte(`"ok":true`)) {
		t.Fatalf("%d %s", recorder.Code, recorder.Body)
	}
}
