package node

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegisterRunscKeepsOtherSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "daemon.json")
	if err := os.WriteFile(path, []byte(`{"log-driver":"journald","runtimes":{"nvidia":{"path":"nvidia-container-runtime"}}}`), 0644); err != nil {
		t.Fatal(err)
	}
	changed, err := registerRunsc(path, "/usr/bin/runsc")
	if err != nil || !changed {
		t.Fatalf("changed %v, %v", changed, err)
	}
	var settings map[string]any
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &settings); err != nil {
		t.Fatal(err)
	}
	runtimes := settings["runtimes"].(map[string]any)
	if settings["log-driver"] != "journald" || runtimes["nvidia"] == nil || runtimes["runsc"].(map[string]any)["path"] != "/usr/bin/runsc" {
		t.Fatalf("settings %s", data)
	}
	if changed, err := registerRunsc(path, "/usr/bin/runsc"); err != nil || changed {
		t.Fatalf("second run changed %v, %v", changed, err)
	}
	fresh := filepath.Join(t.TempDir(), "none", "daemon.json")
	if changed, err := registerRunsc(fresh, "/usr/bin/runsc"); err != nil || !changed {
		t.Fatalf("fresh %v %v", changed, err)
	}
}

func TestSandboxesUnit(t *testing.T) {
	unit := sandboxesUnit("/usr/local/bin/kimono", "100.64.0.5:7480", "ghcr.io/kimonoapps/kimono-sandbox:0.1.0", "")
	if !strings.Contains(unit, "ExecStart=/usr/local/bin/kimono node sandboxes serve --listen 100.64.0.5:7480 --key-file /etc/kimono/sandboxes.key --image ghcr.io/kimonoapps/kimono-sandbox:0.1.0") {
		t.Fatal(unit)
	}
}

func TestPreviewsTunnel(t *testing.T) {
	config := previewsTunnelConfig("abc-123")
	for _, want := range []string{"tunnel: abc-123", "credentials-file: /etc/cloudflared/credentials.json", "ingress:\n  - service: http://127.0.0.1:7482\n"} {
		if !strings.Contains(config, want) {
			t.Errorf("tunnel config lacks %q:\n%s", want, config)
		}
	}
	if strings.Contains(config, "hostname:") {
		t.Error("the previews tunnel must answer for every name, not list them")
	}
	unit := sandboxesUnit("/usr/local/bin/kimono", "100.64.0.5:7480", "img", "Example.dev")
	if !strings.Contains(unit, "--state-dir /var/lib/kimono/sandboxes --preview-domain Example.dev\n") {
		t.Errorf("unit:\n%s", unit)
	}
}

// An update keeps what the node was set up with: its address and preview
// domain come back out of the service it wrote.
func TestSandboxesUnitReadsBackItsSettings(t *testing.T) {
	for _, domain := range []string{"", "previews.example.dev"} {
		unit := sandboxesUnit("/usr/local/bin/kimono", "100.64.0.5:7480", "ghcr.io/kimonoapps/kimono-sandbox:0.4.0", domain)
		got, err := readSandboxesUnit(unit)
		if err != nil {
			t.Fatal(err)
		}
		if got.listen != "100.64.0.5:7480" || got.image != "ghcr.io/kimonoapps/kimono-sandbox:0.4.0" || got.previewDomain != domain {
			t.Fatalf("read back %+v from:\n%s", got, unit)
		}
	}
	if _, err := readSandboxesUnit("[Service]\nRestart=always\n"); err == nil {
		t.Fatal("a unit with no ExecStart should be refused")
	}
}
