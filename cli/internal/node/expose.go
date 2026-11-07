package node

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

const (
	exposureNetwork = "kimono-web"
	exposureTunnel  = "kimono-cloudflared"
)

// cloudflaredVersion is the one release of cloudflared a node installs and
// runs, the same the reconciler's connectors use. The package is installed as
// root, so it is checked against digests recorded here (from Cloudflare's
// release notes, which GitHub's own asset digests agree with) rather than
// trusting whatever the download returns. Bump all three together.
const cloudflaredVersion = "2026.8.0"

var cloudflaredPackageDigests = map[string]string{
	"amd64": "81b5cd625beae2b64e025073402a69c0e8571aeda45a1f4726e33adab3e5824d",
	"arm64": "d84438ebce2badd4662dd92099769ca07b7b4337ab29cbeef65e621e9ef2de33",
}

type Exposure struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	Kind     string `json:"kind"`
	Target   string `json:"target"`
	Service  string `json:"service"`
}

type ExposureConfig struct {
	Provider        string              `json:"provider"`
	Domain          string              `json:"domain"`
	TunnelID        string              `json:"tunnel_id"`
	CertificatePath string              `json:"certificate_path"`
	CredentialsPath string              `json:"credentials_path"`
	Items           map[string]Exposure `json:"items"`
}

func (m *Manager) expose(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node expose", flag.ContinueOnError)
	nameFlag := flags.String("name", "", "exposure name")
	hostFlag := flags.String("hostname", "", "complete or short public hostname")
	domainFlag := flags.String("domain", "", "Cloudflare domain used when setting up convenience exposure")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("usage: kimono node expose [--name NAME] [--hostname HOST] [--domain DOMAIN] <container:port|port>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	if config.Exposure == nil {
		if err := m.setupExposure(&config, *domainFlag); err != nil {
			return err
		}
	}
	exposure, err := parseTarget(flags.Arg(0))
	if err != nil {
		return err
	}
	if *nameFlag != "" {
		exposure.Name = slug(*nameFlag)
	}
	if exposure.Name == "" {
		return errors.New("host ports require --name")
	}
	if *hostFlag == "" {
		exposure.Hostname = exposure.Name + "-" + config.Machine + "." + config.Exposure.Domain
	} else {
		exposure.Hostname = strings.Trim(strings.ToLower(strings.TrimSpace(*hostFlag)), ".")
		if !strings.Contains(exposure.Hostname, ".") {
			exposure.Hostname += "." + config.Exposure.Domain
		}
	}
	if !validHostname(exposure.Hostname) {
		return fmt.Errorf("invalid hostname %q", exposure.Hostname)
	}
	if _, exists := config.Exposure.Items[exposure.Name]; exists {
		return fmt.Errorf("%q is already exposed", exposure.Name)
	}
	if exposure.Kind == "docker" {
		if err := m.connectExposureContainer(exposure.Target); err != nil {
			return err
		}
	}
	if err := m.Runner.Run("cloudflared", "tunnel", "--origincert", config.Exposure.CertificatePath, "route", "dns", config.Exposure.TunnelID, exposure.Hostname); err != nil {
		return err
	}
	config.Exposure.Items[exposure.Name] = exposure
	if err := m.save(config); err != nil {
		return err
	}
	if err := m.renderExposureTunnel(config.Exposure); err != nil {
		return err
	}
	if err := m.restartExposureTunnel(); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Convenience exposure ready: https://%s\n", exposure.Hostname)
	return nil
}

func (m *Manager) setupExposure(config *Config, domain string) error {
	reader := bufio.NewReader(m.Runner.Stdin)
	domain = strings.Trim(strings.ToLower(strings.TrimSpace(domain)), ".")
	if domain == "" {
		domain = strings.Trim(prompt(reader, m.Runner.Stdout, "Cloudflare domain for optional local exposure", ""), ".")
	}
	if domain == "" {
		return errors.New("an exposure domain is required")
	}
	if err := m.ensureExposurePackages(); err != nil {
		return err
	}
	if err := m.ensureExposureNetwork(); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Open the Cloudflare URL to authorize this optional client-side tunnel.")
	if err := m.Runner.Run("cloudflared", "tunnel", "login"); err != nil {
		return err
	}
	name := "kimono-client-" + config.Machine
	if err := m.Runner.Run("cloudflared", "tunnel", "create", name); err != nil {
		return err
	}
	id, err := m.findExposureTunnel(name)
	if err != nil {
		return err
	}
	credential, err := findCloudflareFile(id + ".json")
	if err != nil {
		return err
	}
	certificate, err := findCloudflareFile("cert.pem")
	if err != nil {
		return err
	}
	destination := filepath.Join(m.exposureDir(), "credentials.json")
	if err := system.CopyFile(credential, destination, 0600); err != nil {
		return err
	}
	config.Exposure = &ExposureConfig{Provider: "cloudflare", Domain: domain, TunnelID: id, CertificatePath: certificate, CredentialsPath: destination, Items: map[string]Exposure{}}
	return m.save(*config)
}

func (m *Manager) unexpose(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if len(args) != 1 {
		return errors.New("usage: kimono node unexpose <name>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	if config.Exposure == nil {
		return errors.New("no convenience exposures are configured")
	}
	name := slug(args[0])
	if _, ok := config.Exposure.Items[name]; !ok {
		return fmt.Errorf("no exposure named %q", name)
	}
	delete(config.Exposure.Items, name)
	if err := m.save(config); err != nil {
		return err
	}
	if err := m.renderExposureTunnel(config.Exposure); err != nil {
		return err
	}
	return m.restartExposureTunnel()
}

func (m *Manager) listExposures() error {
	config, err := m.load()
	if err != nil {
		return err
	}
	if config.Exposure == nil || len(config.Exposure.Items) == 0 {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "No convenience exposures.")
		return nil
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "NAME\tTARGET\tURL")
	for _, name := range sortedExposureNames(config.Exposure) {
		item := config.Exposure.Items[name]
		_, _ = fmt.Fprintf(m.Runner.Stdout, "%s\t%s\thttps://%s\n", name, item.Target, item.Hostname)
	}
	return nil
}

func (m *Manager) inspectExposure(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: kimono node inspect <name>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	if config.Exposure == nil {
		return errors.New("no convenience exposures are configured")
	}
	item, ok := config.Exposure.Items[slug(args[0])]
	if !ok {
		return fmt.Errorf("no exposure named %q", args[0])
	}
	data, _ := json.MarshalIndent(item, "", "  ")
	_, _ = fmt.Fprintln(m.Runner.Stdout, string(data))
	return nil
}

func (m *Manager) exposureLogs() error {
	return m.Runner.Run("docker", "logs", "-f", "--tail", "200", exposureTunnel)
}

func (m *Manager) ensureExposurePackages() error {
	if !m.Runner.Exists("apt-get") {
		return errors.New("automatic convenience exposure setup supports Ubuntu/Debian only")
	}
	if !m.Runner.Exists("docker") {
		if err := m.Runner.Run("apt-get", "update"); err != nil {
			return err
		}
		if err := m.Runner.Run("apt-get", "install", "-y", "docker.io", "curl", "ca-certificates"); err != nil {
			return err
		}
	}
	if m.Runner.Exists("systemctl") {
		if err := m.Runner.Run("systemctl", "enable", "--now", "docker"); err != nil {
			return err
		}
	}
	if m.Runner.Exists("cloudflared") {
		return nil
	}
	arch := runtime.GOARCH
	digest, supported := cloudflaredPackageDigests[arch]
	if !supported {
		return fmt.Errorf("cloudflared does not support %s", runtime.GOARCH)
	}
	// A private directory of its own: a fixed name in a shared /tmp could be
	// planted, or swapped between the download and dpkg, by any local user.
	directory, err := os.MkdirTemp("", "kimono-cloudflared-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "cloudflared.deb")
	url := "https://github.com/cloudflare/cloudflared/releases/download/" + cloudflaredVersion + "/cloudflared-linux-" + arch + ".deb"
	if err := download(url, path); err != nil {
		return err
	}
	if err := verifyDigest(path, digest); err != nil {
		return fmt.Errorf("cloudflared %s package: %w", cloudflaredVersion, err)
	}
	return m.Runner.Run("dpkg", "-i", path)
}

func verifyDigest(path, expected string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); actual != expected {
		return fmt.Errorf("checksum mismatch: got %s, expected %s", actual, expected)
	}
	return nil
}

func (m *Manager) ensureExposureNetwork() error {
	if _, err := m.Runner.Output("docker", "network", "inspect", exposureNetwork); err == nil {
		return nil
	}
	return m.Runner.Run("docker", "network", "create", exposureNetwork)
}

func (m *Manager) connectExposureContainer(name string) error {
	output, err := m.Runner.Output("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", name)
	if err != nil {
		return fmt.Errorf("container %q is unavailable: %w", name, err)
	}
	if strings.Contains(string(output), `"`+exposureNetwork+`"`) {
		return nil
	}
	return m.Runner.Run("docker", "network", "connect", exposureNetwork, name)
}

func (m *Manager) renderExposureTunnel(config *ExposureConfig) error {
	var builder strings.Builder
	fmt.Fprintf(&builder, "tunnel: %s\ncredentials-file: /etc/cloudflared/credentials.json\nno-autoupdate: true\n\ningress:\n", config.TunnelID)
	for _, name := range sortedExposureNames(config) {
		item := config.Items[name]
		fmt.Fprintf(&builder, "  - hostname: %s\n    service: %s\n", item.Hostname, item.Service)
	}
	builder.WriteString("  - service: http_status:404\n")
	if err := os.MkdirAll(m.exposureDir(), 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.exposureDir(), "config.yml"), []byte(builder.String()), 0600)
}

func (m *Manager) restartExposureTunnel() error {
	if _, err := m.Runner.Output("docker", "inspect", exposureTunnel); err == nil {
		if err := m.Runner.Run("docker", "rm", "-f", exposureTunnel); err != nil {
			return err
		}
	}
	return m.Runner.Run("docker", "run", "-d", "--name", exposureTunnel, "--restart", "unless-stopped", "--network", exposureNetwork, "--add-host", "host.docker.internal:host-gateway", "-v", m.exposureDir()+":/etc/cloudflared:ro", "cloudflare/cloudflared:"+cloudflaredVersion, "tunnel", "--no-autoupdate", "--config", "/etc/cloudflared/config.yml", "run")
}

func (m *Manager) findExposureTunnel(name string) (string, error) {
	output, err := m.Runner.Output("cloudflared", "tunnel", "list", "--output", "json")
	if err != nil {
		return "", err
	}
	var tunnels []struct{ ID, Name string }
	if err := json.Unmarshal(output, &tunnels); err != nil {
		return "", err
	}
	for _, tunnel := range tunnels {
		if tunnel.Name == name {
			return tunnel.ID, nil
		}
	}
	return "", fmt.Errorf("Cloudflare tunnel %q was not found after creation", name)
}

func parseTarget(value string) (Exposure, error) {
	value = strings.TrimSpace(value)
	if strings.Contains(value, ":") {
		parts := strings.Split(value, ":")
		if len(parts) != 2 || !validContainerName(parts[0]) {
			return Exposure{}, errors.New("Docker targets must use container:port")
		}
		port, err := validPort(parts[1])
		if err != nil {
			return Exposure{}, err
		}
		return Exposure{Name: slug(parts[0]), Kind: "docker", Target: parts[0], Service: "http://" + parts[0] + ":" + port}, nil
	}
	port, err := validPort(value)
	if err != nil {
		return Exposure{}, errors.New("targets must use container:port or a host port")
	}
	return Exposure{Kind: "host", Target: port, Service: "http://host.docker.internal:" + port}, nil
}

func validContainerName(value string) bool {
	if value == "" || strings.ContainsAny(value, " /\\") {
		return false
	}
	for _, character := range value {
		if !(character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || strings.ContainsRune("-_.", character)) {
			return false
		}
	}
	return value[0] != '-' && value[0] != '.' && value[0] != '_'
}
func validPort(value string) (string, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid port %q", value)
	}
	return strconv.Itoa(port), nil
}
func validHostname(value string) bool {
	if len(value) == 0 || len(value) > 253 || !strings.Contains(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || slug(label) != label {
			return false
		}
	}
	return true
}
func sortedExposureNames(config *ExposureConfig) []string {
	names := make([]string, 0, len(config.Items))
	for name := range config.Items {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
func (m *Manager) exposureDir() string { return filepath.Join(m.Home, "client-exposure") }

func findCloudflareFile(name string) (string, error) {
	candidates := []string{filepath.Join("/root/.cloudflared", name)}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append([]string{filepath.Join(home, ".cloudflared", name)}, candidates...)
	}
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("could not find cloudflared %s", name)
}
func download(url, path string) error {
	response, err := (&http.Client{Timeout: 5 * time.Minute}).Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("download %s: %s", url, response.Status)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, response.Body); err != nil {
		_ = file.Close()
		return err
	}
	return file.Close()
}
