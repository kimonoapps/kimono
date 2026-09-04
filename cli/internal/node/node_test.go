package node

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestParseConvenienceTargets(t *testing.T) {
	dockerTarget, err := parseTarget("notes:3000")
	if err != nil || dockerTarget.Service != "http://notes:3000" {
		t.Fatalf("unexpected Docker target: %#v %v", dockerTarget, err)
	}
	hostTarget, err := parseTarget("8080")
	if err != nil || hostTarget.Service != "http://host.docker.internal:8080" {
		t.Fatalf("unexpected host target: %#v %v", hostTarget, err)
	}
}

func TestSlug(t *testing.T) {
	if got := slug("  Kitchen Laptop  "); got != "kitchen-laptop" {
		t.Fatalf("unexpected slug %q", got)
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

func TestValidateHostingTLS(t *testing.T) {
	valid := hostingTLSOptions{hostname: "node1.example.com", email: "owner@example.com", port: 8080, challenge: "http"}
	if err := validateHostingTLS(valid); err != nil {
		t.Fatal(err)
	}
	invalid := []hostingTLSOptions{
		{hostname: "node1", email: valid.email, port: valid.port, challenge: valid.challenge},
		{hostname: valid.hostname, email: "not-an-email", port: valid.port, challenge: valid.challenge},
		{hostname: valid.hostname, email: valid.email, port: 0, challenge: valid.challenge},
		{hostname: valid.hostname, email: valid.email, port: valid.port, challenge: "tls-alpn"},
		{hostname: valid.hostname, email: valid.email, port: valid.port, challenge: "cloudflare"},
	}
	for _, options := range invalid {
		if err := validateHostingTLS(options); err == nil {
			t.Fatalf("expected options %#v to be rejected", options)
		}
	}
}

func TestCertbotArgumentsDoNotRequirePort443(t *testing.T) {
	httpOptions := hostingTLSOptions{hostname: "node1.example.com", email: "owner@example.com", port: 8080, challenge: "http"}
	httpArguments := certbotArguments(httpOptions, "")
	if !slices.Contains(httpArguments, "--standalone") || !slices.Contains(httpArguments, "http") || slices.Contains(httpArguments, "443") {
		t.Fatalf("unexpected HTTP challenge arguments: %q", httpArguments)
	}

	dnsOptions := httpOptions
	dnsOptions.challenge = "cloudflare"
	dnsArguments := certbotArguments(dnsOptions, "/var/lib/kimono/hosting/cloudflare.ini")
	if !slices.Contains(dnsArguments, "--dns-cloudflare") || !slices.Contains(dnsArguments, "/var/lib/kimono/hosting/cloudflare.ini") || slices.Contains(dnsArguments, "443") {
		t.Fatalf("unexpected DNS challenge arguments: %q", dnsArguments)
	}
}

func TestWriteCloudflareCredentialsProtectsToken(t *testing.T) {
	home := t.TempDir()
	source := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(source, []byte("secret-token\n"), 0600); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{Home: home}
	destination, err := manager.writeCloudflareCredentials(source)
	if err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(contents), "dns_cloudflare_api_token = secret-token") {
		t.Fatalf("unexpected credentials: %q", contents)
	}
	info, err := os.Stat(destination)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("credentials mode = %o, expected 600", info.Mode().Perm())
	}
}
