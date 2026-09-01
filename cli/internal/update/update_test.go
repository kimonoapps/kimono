package update

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
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

// A release whose checksum does not match must never be written over the
// running binary, because the replacement is what every later command runs.
func TestReplaceBinaryRejectsAMismatchedChecksum(t *testing.T) {
	asset, err := assetName()
	if err != nil {
		t.Skipf("unsupported architecture %s", runtime.GOARCH)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/SHA256SUMS" {
			fmt.Fprintf(w, "%s  %s\n", "not-the-real-digest", asset)
			return
		}
		fmt.Fprint(w, "replacement binary")
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
	payload := []byte("current binary")
	digest := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/SHA256SUMS" {
			fmt.Fprintf(w, "%s  %s\n", hex.EncodeToString(digest[:]), asset)
			return
		}
		w.Write(payload)
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
