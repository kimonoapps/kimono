package sandbox

import (
	"bytes"
	"crypto/sha1"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// streamingNode is a node whose sandbox is a real container (busybox, from a
// local alpine image): a fake docker CLI passes exec on to it, as root. Only
// with KIMONO_DOCKER_TESTS=1, since it needs Docker.
func streamingNode(t *testing.T, diskGB int) (*httptest.Server, string) {
	t.Helper()
	if os.Getenv("KIMONO_DOCKER_TESTS") != "1" {
		t.Skip("set KIMONO_DOCKER_TESTS=1 to run against Docker")
	}
	real, err := exec.LookPath("docker")
	if err != nil {
		t.Skip("no docker")
	}
	image := os.Getenv("KIMONO_TEST_IMAGE")
	if image == "" {
		image = "redis:7.4-alpine"
	}
	out, err := exec.Command(real, "run", "-d", "--rm", "--entrypoint", "sleep", image, "600").Output()
	if err != nil {
		t.Skipf("can't start %s: %v", image, err)
	}
	container := strings.TrimSpace(string(out))
	t.Cleanup(func() { _ = exec.Command(real, "rm", "-f", container).Run() })
	if err := exec.Command(real, "exec", container, "sh", "-c", "mkdir -p /workspace /home/agent").Run(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	fake := filepath.Join(dir, "docker")
	/* exec goes to the real container as root; -u agent goes, and the sandbox's name becomes the container's. */
	script := fmt.Sprintf(`#!/bin/bash
case "$*" in *"container inspect"*) echo running; exit 0 ;; esac
[ "$1" = exec ] || exit 0
shift
out=()
while [ $# -gt 0 ]; do
  case "$1" in
    -u) shift 2 ;;
    kimono-sbx-*) out+=(%q); shift; out+=("$@"); break ;;
    *) out+=("$1"); shift ;;
  esac
done
exec %q exec "${out[@]}"
`, container, real)
	if err := os.WriteFile(fake, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	s, err := New(Config{Key: "k", StateDir: t.TempDir(), Docker: fake})
	if err != nil {
		t.Fatal(err)
	}
	s.docker = docker{bin: fake}
	s.limits.DiskGB = diskGB
	s.records["ws1"] = &record{}
	front := httptest.NewServer(s.Handler())
	t.Cleanup(front.Close)
	return front, container
}

func call(t *testing.T, method, url string, body io.Reader, length int64) *http.Response {
	t.Helper()
	request, _ := http.NewRequest(method, url, body)
	request.Header.Set("Authorization", "Bearer k")
	if body != nil {
		request.ContentLength = length
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestBigFilesStreamBothWays(t *testing.T) {
	front, _ := streamingNode(t, 10)
	big := bytes.Repeat([]byte("kimono video "), 6<<20) // 78 MB: past the old 50 MB cap
	put := call(t, "PUT", front.URL+"/v1/workspaces/ws1/file?path=.kimono/files/School/1108.mp4", bytes.NewReader(big), int64(len(big)))
	if put.StatusCode != 204 {
		said, _ := io.ReadAll(put.Body)
		t.Fatalf("put: %d %s", put.StatusCode, said)
	}
	get := call(t, "GET", front.URL+"/v1/workspaces/ws1/file?full=1&path=.kimono/files/School/1108.mp4", nil, 0)
	defer get.Body.Close()
	if get.StatusCode != 200 || get.ContentLength != int64(len(big)) {
		t.Fatalf("get: %d, length %d", get.StatusCode, get.ContentLength)
	}
	hash := sha1.New()
	if n, err := io.Copy(hash, get.Body); err != nil || n != int64(len(big)) {
		t.Fatalf("read %d bytes: %v", n, err)
	}
	if want := sha1.Sum(big); !bytes.Equal(hash.Sum(nil), want[:]) {
		t.Fatal("what came out isn't what went in")
	}
	/* Without ?full=1 it's still the 2 MB viewing cap. */
	if view := call(t, "GET", front.URL+"/v1/workspaces/ws1/file?path=.kimono/files/School/1108.mp4", nil, 0); view.StatusCode != 413 {
		t.Fatalf("view: %d", view.StatusCode)
	}
}

func TestShortPutLeavesNothing(t *testing.T) {
	front, container := streamingNode(t, 10)
	/* Says 10 bytes, sends 4: the client errors, and no half file is left under either name. */
	request, _ := http.NewRequest("PUT", front.URL+"/v1/workspaces/ws1/file?path=half.txt", io.NopCloser(strings.NewReader("half")))
	request.Header.Set("Authorization", "Bearer k")
	request.ContentLength = 10
	if response, err := http.DefaultClient.Do(request); err == nil && response.StatusCode == 204 {
		t.Fatal("a short file was taken")
	}
	out, _ := exec.Command("docker", "exec", container, "sh", "-c", "ls /workspace").Output()
	if strings.Contains(string(out), "half") {
		t.Fatalf("left behind: %s", out)
	}
}

func TestPutThatWontFitSaysSo(t *testing.T) {
	front, _ := streamingNode(t, 1)
	/* 900 MB said, against 1 GB less the 256 MB kept free: refused before any byte is read. */
	response := call(t, "PUT", front.URL+"/v1/workspaces/ws1/file?path=huge.mp4", io.LimitReader(zeros{}, 900<<20), 900<<20)
	defer response.Body.Close()
	if response.StatusCode != http.StatusInsufficientStorage {
		t.Fatalf("status %d", response.StatusCode)
	}
	said, _ := io.ReadAll(response.Body)
	if !strings.Contains(string(said), `"room":`) {
		t.Fatalf("said %s", said)
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) { clear(p); return len(p), nil }
