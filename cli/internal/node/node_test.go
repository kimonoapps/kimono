package node

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/kimonoapps/kimono/cli/internal/system"
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

func TestHostingNodeDoesNotRequireMeshEnrollment(t *testing.T) {
	home := t.TempDir()
	stdout := &bytes.Buffer{}
	manager := &Manager{
		Home: home,
		Runner: &system.Runner{
			DryRun: true,
			Stdin:  strings.NewReader(""),
			Stdout: stdout,
			Stderr: &bytes.Buffer{},
		},
	}
	config, err := manager.loadOptional()
	if err != nil {
		t.Fatal(err)
	}
	config.Hosting = &HostingConfig{
		Hostname:  "node2.example.com",
		Port:      8080,
		Challenge: "cloudflare",
	}
	if err := manager.save(config); err != nil {
		t.Fatal(err)
	}
	if err := manager.status(); err != nil {
		t.Fatal(err)
	}
	output := stdout.String()
	if !strings.Contains(output, "Hosting node: https://node2.example.com:8080") {
		t.Fatalf("hosting status missing from %q", output)
	}
	if strings.Contains(output, "tailscale") || strings.Contains(output, "Mesh:") {
		t.Fatalf("standalone hosting node unexpectedly requires mesh: %q", output)
	}
}

// The enrollment key reaches tailscale as a file, never as an argument any
// local user could read from the process list, and the file is gone after.
func TestTailscaleUpKeepsTheKeyOffTheCommandLine(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a shell script as tailscale")
	}
	bin := t.TempDir()
	record := filepath.Join(t.TempDir(), "record")
	script := "#!/bin/sh\nprintf '%s\\n' \"$*\" > " + record + "\nfor arg; do case $arg in --auth-key=file:*) cat \"${arg#--auth-key=file:}\" >> " + record + "; echo >> " + record + "; ls -ld \"$(dirname \"${arg#--auth-key=file:}\")\" >> " + record + ";; esac; done\n"
	if err := os.WriteFile(filepath.Join(bin, "tailscale"), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	key := "hskey-auth-0123456789abcdef"
	manager := &Manager{Runner: &system.Runner{Stdout: io.Discard, Stderr: io.Discard}}
	if err := manager.tailscaleUp(key, "--login-server", "https://mesh.example.com"); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(record)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(string(contents), "\n")
	if len(lines) < 3 || strings.Contains(lines[0], key) || !strings.Contains(lines[0], "--auth-key=file:") {
		t.Fatalf("tailscale was called as %q", lines[0])
	}
	if lines[1] != key {
		t.Fatalf("the key file held %q", lines[1])
	}
	if !strings.HasPrefix(lines[2], "drwx------") {
		t.Fatalf("the key's directory is not private: %s", lines[2])
	}
	path := strings.TrimPrefix(lines[0][strings.Index(lines[0], "--auth-key=file:"):], "--auth-key=file:")
	if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
		t.Fatalf("the key's directory was left behind: %v", err)
	}
}

func TestVerifyDigestAcceptsOnlyThePinnedPackage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "package.deb")
	if err := os.WriteFile(path, []byte("package"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := verifyDigest(path, "bc4a71180870f7945155fbb02f4b0a2e3faa2a62d6d31b7039013055ed19869a"); err != nil {
		t.Fatalf("the matching digest was refused: %v", err)
	}
	if err := verifyDigest(path, cloudflaredPackageDigests["amd64"]); err == nil {
		t.Fatal("expected a digest that doesn't match to be refused")
	}
}
