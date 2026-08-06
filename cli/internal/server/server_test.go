package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

func TestExtractApplianceMakesCustomTemplatesTraversable(t *testing.T) {
	home := t.TempDir()
	manager := &Manager{Home: home, Runner: &system.Runner{}}
	if err := manager.extractAppliance(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, "server", "authentik", "custom-templates")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0755 {
		t.Fatalf("custom template permissions = %o, expected 755", got)
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
