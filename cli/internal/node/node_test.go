package node

import "testing"

func TestParseDockerTarget(t *testing.T) {
	exposure, err := parseTarget("notes:3000")
	if err != nil {
		t.Fatal(err)
	}
	if exposure.Name != "notes" || exposure.Kind != "docker" || exposure.Service != "http://notes:3000" {
		t.Fatalf("unexpected exposure: %#v", exposure)
	}
}

func TestParseTargetAcceptsDockerContainerNames(t *testing.T) {
	exposure, err := parseTarget("my_app.1:8080")
	if err != nil {
		t.Fatal(err)
	}
	if exposure.Target != "my_app.1" || exposure.Name != "my-app-1" {
		t.Fatalf("unexpected exposure: %#v", exposure)
	}
}

func TestParseHostTarget(t *testing.T) {
	exposure, err := parseTarget("8080")
	if err != nil {
		t.Fatal(err)
	}
	if exposure.Name != "" || exposure.Kind != "host" || exposure.Service != "http://host.docker.internal:8080" {
		t.Fatalf("unexpected exposure: %#v", exposure)
	}
}

func TestParseTargetRejectsBadPorts(t *testing.T) {
	for _, value := range []string{"0", "65536", "notes:nope", "notes:3:4"} {
		if _, err := parseTarget(value); err == nil {
			t.Errorf("expected %q to fail", value)
		}
	}
}

func TestSlug(t *testing.T) {
	if got := slug("  My Notes_VM  "); got != "my-notes-vm" {
		t.Fatalf("unexpected slug %q", got)
	}
}

func TestValidHostname(t *testing.T) {
	for _, value := range []string{"notes-home.example.com", "a.b"} {
		if !validHostname(value) {
			t.Errorf("expected %q to be valid", value)
		}
	}
	for _, value := range []string{"localhost", "bad_name.example.com", "-bad.example.com"} {
		if validHostname(value) {
			t.Errorf("expected %q to be invalid", value)
		}
	}
}

func TestValidateEnrollmentKey(t *testing.T) {
	if err := validateEnrollmentKey("hskey-auth-example-prefix-example-secret"); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"", "not-a-key", "hskey-auth-short"} {
		if err := validateEnrollmentKey(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}
