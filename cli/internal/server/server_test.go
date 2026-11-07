package server

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/kimonoapps/kimono/cli/internal/sandbox"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

func TestExtractApplianceMakesBindMountsTraversable(t *testing.T) {
	home := t.TempDir()
	manager := &Manager{Home: home, Runner: &system.Runner{}}
	if err := manager.extractAppliance(); err != nil {
		t.Fatal(err)
	}
	// Authentik and the Portal read these as non-root users.
	for _, directory := range []string{
		filepath.Join("authentik", "custom-templates"),
		"app-definitions",
	} {
		info, err := os.Stat(filepath.Join(home, "server", directory))
		if err != nil {
			t.Fatal(err)
		}
		if got := info.Mode().Perm(); got != 0755 {
			t.Fatalf("%s permissions = %o, expected 755", directory, got)
		}
	}
}

func TestPreservedOrRandom(t *testing.T) {
	called := false
	value, err := preservedOrRandom(map[string]string{"SECRET": "keep-me"}, "SECRET", func() (string, error) {
		called = true
		return "new", nil
	})
	if err != nil || value != "keep-me" || called {
		t.Fatalf("value=%q called=%v err=%v", value, called, err)
	}
}

func TestEnrollmentTag(t *testing.T) {
	for role, expected := range map[string]string{
		"node":  "tag:kimono-node",
		"ADMIN": "tag:kimono-admin",
	} {
		got, err := enrollmentTag(role)
		if err != nil || got != expected {
			t.Fatalf("enrollmentTag(%q) = %q, %v; expected %q", role, got, err, expected)
		}
	}
	if _, err := enrollmentTag("owner"); err == nil {
		t.Fatal("expected unsupported enrollment role to fail")
	}
}

func TestQualifyHostname(t *testing.T) {
	for _, test := range []struct {
		value, fallback, base, expected string
	}{
		{"", "notes", "example.com", "notes.example.com"},
		{"family", "notes", "example.com", "family.example.com"},
		{"notes.other.test", "notes", "example.com", "notes.other.test"},
		{"@", "portal", "example.com", "example.com"},
	} {
		if got := qualifyHostname(test.value, test.fallback, test.base); got != test.expected {
			t.Fatalf("qualifyHostname(%q) = %q, expected %q", test.value, got, test.expected)
		}
	}
}

func TestReleaseImageTagFollowsTheRelease(t *testing.T) {
	for version, expected := range map[string]string{
		"v0.9.3":      "v0.9.3",
		"v1.0.0-rc.1": "v1.0.0-rc.1",
		"0.1.0-dev":   "latest",
		"dev":         "latest",
	} {
		if got := releaseImageTag(version); got != expected {
			t.Fatalf("releaseImageTag(%q) = %q, expected %q", version, got, expected)
		}
	}
}

// An update moves images Kimono chose (latest, or an older release) to this
// release, keeps a tag the operator chose, and adds a missing one.
func TestPinReleaseImages(t *testing.T) {
	previous := sandbox.Version
	sandbox.Version = "v0.9.3"
	t.Cleanup(func() { sandbox.Version = previous })
	for _, test := range []struct{ before, expected string }{
		{"KIMONO_PORTAL_TAG=latest\nKIMONO_RECONCILER_TAG=v0.9.1\n", "KIMONO_PORTAL_TAG=v0.9.3\nKIMONO_RECONCILER_TAG=v0.9.3\n"},
		{"KIMONO_PORTAL_TAG=local-build\nKIMONO_RECONCILER_TAG=latest\n", "KIMONO_PORTAL_TAG=local-build\nKIMONO_RECONCILER_TAG=v0.9.3\n"},
		{"PG_DB=authentik", "PG_DB=authentik\nKIMONO_PORTAL_TAG=v0.9.3\nKIMONO_RECONCILER_TAG=v0.9.3\n"},
	} {
		home := t.TempDir()
		manager := &Manager{Home: home, Runner: &system.Runner{}}
		if err := os.WriteFile(manager.envPath(), []byte(test.before), 0600); err != nil {
			t.Fatal(err)
		}
		if err := manager.pinReleaseImages(); err != nil {
			t.Fatal(err)
		}
		contents, err := os.ReadFile(manager.envPath())
		if err != nil {
			t.Fatal(err)
		}
		if string(contents) != test.expected {
			t.Fatalf("from %q:\n%s\nexpected:\n%s", test.before, contents, test.expected)
		}
		if info, _ := os.Stat(manager.envPath()); info.Mode().Perm() != 0600 {
			t.Fatalf("server.env permissions = %o", info.Mode().Perm())
		}
	}
}

// Caddy and Headscale trust forwarded addresses only from the fixed ranges
// compose.yml gives the networks; the three files must agree.
func TestProxyTrustMatchesTheApplianceNetworks(t *testing.T) {
	read := func(name string) string {
		data, err := os.ReadFile(filepath.Join("..", "..", "..", "infra", "compose", "server", name))
		if err != nil {
			t.Fatal(err)
		}
		return string(data)
	}
	compose, caddyfile, headscale := read("compose.yml"), read("Caddyfile"), read(filepath.Join("headscale", "config.yaml.tmpl"))
	for _, expected := range []string{"subnet: " + edgeSubnet, "ip_range: 10.89.0.128/25", "internal: true", "subnet: 10.89.2.0/24", "ip_range: 10.89.2.128/25", "ipv4_address: 10.89.1.2", "ip_range: 10.89.1.128/25"} {
		if !strings.Contains(compose, expected) {
			t.Fatalf("compose.yml lacks %q", expected)
		}
	}
	if !strings.Contains(caddyfile, "trusted_proxies static 10.89.2.128/25\n") {
		t.Fatal("Caddy trusts something other than kimono-tunnel's connectors")
	}
	if !strings.Contains(headscale, "trusted_proxies:\n  - 10.89.1.2/32\n") {
		t.Fatal("Headscale trusts something other than Caddy")
	}
}
