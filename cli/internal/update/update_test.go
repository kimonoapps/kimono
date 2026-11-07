package update

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

func TestChecksumForIgnoresOtherAssets(t *testing.T) {
	sums := "aaa  kimono_linux_arm64\nbbb  kimono_linux_amd64\n"
	if got := checksumFor(sums, "kimono_linux_amd64"); got != "bbb" {
		t.Fatalf("expected the matching checksum, got %q", got)
	}
	if got := checksumFor(sums, "kimono_darwin_amd64"); got != "" {
		t.Fatal("expected a missing asset to report no checksum")
	}
}

// testReleaseKey makes the tests' own release key the trusted one for the
// rest of the test, and returns a signer in the workflow's format.
func testReleaseKey(t *testing.T) func(string) string {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	previous := trustedReleaseKey
	trustedReleaseKey = public
	t.Cleanup(func() { trustedReleaseKey = previous })
	return func(sums string) string {
		return base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte(sums)))
	}
}

// The workflow signs with openssl; this signature was made that way over the
// sums below with the key the CLI embeds, so the two formats can't drift.
func TestReleaseKeyAcceptsTheWorkflowsSignature(t *testing.T) {
	sums := []byte("abc  kimono_linux_amd64\n")
	signature := []byte("GAJDrAXxGah7Lv186mmUVlDKzwHaLIjTDn3xK/kUw6hMiMeZlH1GVrRlvbni89HOxHbks6966Y2ixdQHDYYLDw==\n")
	if !signedByRelease(sums, signature) {
		t.Fatal("the embedded key rejected a signature made by the release key")
	}
	if signedByRelease([]byte("abd  kimono_linux_amd64\n"), signature) {
		t.Fatal("a signature verified checksums it was not made over")
	}
}

// Checksums anyone could have written must not be enough: whoever can replace
// the binary can replace SHA256SUMS beside it.
func TestReplaceBinaryRejectsUnsignedChecksums(t *testing.T) {
	asset, err := assetName()
	if err != nil {
		t.Skipf("unsupported architecture %s", runtime.GOARCH)
	}
	testReleaseKey(t)
	payload := []byte("replacement binary")
	digest := sha256.Sum256(payload)
	sums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(digest[:]), asset)
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	for name, signature := range map[string]string{
		"missing":        "",
		"garbage":        "not a signature",
		"someone else's": base64.StdEncoding.EncodeToString(ed25519.Sign(otherKey, []byte(sums))),
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/SHA256SUMS":
				fmt.Fprint(w, sums)
			case "/SHA256SUMS.sig":
				if signature == "" {
					http.NotFound(w, r)
					return
				}
				fmt.Fprint(w, signature)
			default:
				w.Write(payload)
			}
		}))
		t.Setenv("KIMONO_DOWNLOAD_BASE", server.URL)
		executable := filepath.Join(t.TempDir(), "kimono")
		if err := os.WriteFile(executable, []byte("original binary"), 0755); err != nil {
			t.Fatal(err)
		}
		manager := &Manager{Runner: system.NewRunner(), Client: server.Client()}
		if _, err := manager.replaceBinary(executable); err == nil {
			t.Fatalf("%s signature: expected the update to be refused", name)
		}
		server.Close()
		contents, err := os.ReadFile(executable)
		if err != nil || string(contents) != "original binary" {
			t.Fatalf("%s signature: the running binary was modified: %q (%v)", name, contents, err)
		}
	}
}

// A release whose checksum does not match must never be written over the
// running binary, because the replacement is what every later command runs.
func TestReplaceBinaryRejectsAMismatchedChecksum(t *testing.T) {
	asset, err := assetName()
	if err != nil {
		t.Skipf("unsupported architecture %s", runtime.GOARCH)
	}
	sign := testReleaseKey(t)
	sums := fmt.Sprintf("%s  %s\n", "not-the-real-digest", asset)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/SHA256SUMS":
			fmt.Fprint(w, sums)
		case "/SHA256SUMS.sig":
			fmt.Fprint(w, sign(sums))
		default:
			fmt.Fprint(w, "replacement binary")
		}
	}))
	defer server.Close()
	t.Setenv("KIMONO_DOWNLOAD_BASE", server.URL)

	executable := filepath.Join(t.TempDir(), "kimono")
	if err := os.WriteFile(executable, []byte("original binary"), 0755); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{Runner: system.NewRunner(), Client: server.Client()}
	if _, err := manager.replaceBinary(executable); err == nil {
		t.Fatal("expected a checksum mismatch to fail")
	}
	contents, err := os.ReadFile(executable)
	if err != nil || string(contents) != "original binary" {
		t.Fatalf("the running binary was modified: %q (%v)", contents, err)
	}
}

func TestReplaceBinarySkipsAnIdenticalRelease(t *testing.T) {
	asset, err := assetName()
	if err != nil {
		t.Skipf("unsupported architecture %s", runtime.GOARCH)
	}
	sign := testReleaseKey(t)
	payload := []byte("current binary")
	digest := sha256.Sum256(payload)
	sums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(digest[:]), asset)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/SHA256SUMS":
			fmt.Fprint(w, sums)
		case "/SHA256SUMS.sig":
			fmt.Fprint(w, sign(sums))
		default:
			w.Write(payload)
		}
	}))
	defer server.Close()
	t.Setenv("KIMONO_DOWNLOAD_BASE", server.URL)

	executable := filepath.Join(t.TempDir(), "kimono")
	if err := os.WriteFile(executable, payload, 0755); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{Runner: system.NewRunner(), Client: server.Client()}
	replaced, err := manager.replaceBinary(executable)
	if err != nil {
		t.Fatal(err)
	}
	if replaced {
		t.Fatal("expected an unchanged release to report no replacement")
	}
}

// The gate that decides whether to update the appliance once looked for
// server/server.env, a path the installer never writes, so `kimono update`
// quietly refused to update every server it ran on. It must agree with the
// server manager's envPath, and must follow a relocated KIMONO_HOME.
func TestApplianceEnvironmentPathMatchesTheInstalledLayout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("KIMONO_HOME", home)
	expected := filepath.Join(home, "server.env")
	if got := applianceEnvironmentPath(); got != expected {
		t.Fatalf("appliance environment path = %q, expected %q", got, expected)
	}
	if _, err := os.Stat(applianceEnvironmentPath()); !os.IsNotExist(err) {
		t.Fatal("expected no appliance before one is configured")
	}
	if err := os.WriteFile(expected, []byte("KIMONO_BASE_DOMAIN=example.com\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(applianceEnvironmentPath()); err != nil {
		t.Fatalf("a configured appliance was not detected: %v", err)
	}
}

// A sandbox node is updated with the release: its own service, by the new
// binary. A machine that isn't one is left alone.
func TestUpdateRefreshesASandboxNode(t *testing.T) {
	t.Setenv("KIMONO_ALLOW_UNPRIVILEGED", "1")
	t.Setenv("KIMONO_HOME", t.TempDir())
	for _, enabled := range []bool{true, false} {
		previous := sandboxesEnabled
		sandboxesEnabled = func() bool { return enabled }
		var output strings.Builder
		manager := New(&system.Runner{DryRun: true, Stdout: &output, Stderr: &output})
		if err := manager.Run([]string{"--no-self"}); err != nil {
			t.Fatal(err)
		}
		sandboxesEnabled = previous
		if got := strings.Contains(output.String(), "node sandboxes update"); got != enabled {
			t.Fatalf("node %v: ran the node update = %v\n%s", enabled, got, output.String())
		}
	}
}
