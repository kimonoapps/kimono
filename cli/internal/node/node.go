package node

import (
	"bufio"
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
	networkName = "kimono-web"
	tunnelName  = "kimono-cloudflared"
)

type Exposure struct {
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	Kind     string `json:"kind"`
	Target   string `json:"target"`
	Service  string `json:"service"`
}

type Config struct {
	Version         int                 `json:"version"`
	ServerURL       string              `json:"server_url"`
	Domain          string              `json:"domain"`
	Machine         string              `json:"machine"`
	TunnelID        string              `json:"tunnel_id"`
	TunnelName      string              `json:"tunnel_name"`
	CertificatePath string              `json:"certificate_path"`
	CredentialsPath string              `json:"credentials_path"`
	Exposures       map[string]Exposure `json:"exposures"`
}

type Manager struct {
	Runner *system.Runner
	Home   string
}

func New(runner *system.Runner) *Manager {
	return &Manager{Runner: runner, Home: system.Home()}
}

func (m *Manager) Execute(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: kimono node <install|expose|unexpose|list|inspect|status|doctor|logs>")
	}
	switch args[0] {
	case "install":
		return m.install(args[1:])
	case "login":
		return m.login(args[1:])
	case "logout":
		return m.Runner.Run("tailscale", "logout")
	case "expose":
		return m.expose(args[1:])
	case "unexpose":
		return m.unexpose(args[1:])
	case "list":
		return m.list()
	case "inspect":
		return m.inspect(args[1:])
	case "status":
		return m.status()
	case "doctor":
		return m.doctor()
	case "logs":
		return m.Runner.Run("docker", "logs", "-f", "--tail", "200", tunnelName)
	default:
		return fmt.Errorf("unknown node command %q", args[0])
	}
}

func (m *Manager) login(args []string) error {
	config, err := m.load()
	if err != nil {
		return err
	}
	flags := flag.NewFlagSet("node login", flag.ContinueOnError)
	authKey := flags.String("auth-key", "", "single-use key from `kimono server enrollment create`")
	if err := flags.Parse(args); err != nil {
		return err
	}
	key := strings.TrimSpace(*authKey)
	if key == "" {
		key = prompt(bufio.NewReader(m.Runner.Stdin), m.Runner.Stdout, "Single-use Kimono enrollment key", "")
	}
	if err := validateEnrollmentKey(key); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Re-enrolling this VM as an isolated Kimono service node.")
	return m.Runner.RunSensitive("tailscale", "up", "--login-server", config.ServerURL, "--hostname", config.Machine, "--accept-dns=true", "--auth-key", key, "--force-reauth")
}

func (m *Manager) install(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node install", flag.ContinueOnError)
	serverURL := flags.String("server", "", "Kimono Headscale URL")
	domain := flags.String("domain", "", "Cloudflare-managed application domain")
	machine := flags.String("name", "", "machine name used in public hostnames")
	authKey := flags.String("auth-key", "", "single-use key from `kimono server enrollment create`")
	skipPackages := flags.Bool("skip-packages", false, "do not install Docker, Tailscale, or cloudflared")
	if err := flags.Parse(args); err != nil {
		return err
	}
	reader := bufio.NewReader(m.Runner.Stdin)
	if *serverURL == "" {
		*serverURL = prompt(reader, m.Runner.Stdout, "Kimono mesh URL", "")
	}
	*serverURL = strings.TrimRight(strings.TrimSpace(*serverURL), "/")
	if !strings.HasPrefix(*serverURL, "https://") {
		return errors.New("mesh URL must start with https://")
	}
	if *domain == "" {
		*domain = prompt(reader, m.Runner.Stdout, "Cloudflare application domain", "")
	}
	*domain = strings.Trim(strings.TrimSpace(*domain), ".")
	if *machine == "" {
		hostname, _ := os.Hostname()
		*machine = prompt(reader, m.Runner.Stdout, "Machine name", slug(hostname))
	}
	*machine = slug(*machine)
	if *domain == "" || *machine == "" {
		return errors.New("domain and machine name are required")
	}
	key := strings.TrimSpace(*authKey)
	if key == "" {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "On the Kimono server, run: sudo kimono server enrollment create")
		key = prompt(reader, m.Runner.Stdout, "Single-use Kimono enrollment key", "")
	}
	if err := validateEnrollmentKey(key); err != nil {
		return err
	}

	if !*skipPackages {
		if err := m.ensurePackages(); err != nil {
			return err
		}
	}
	if err := m.ensureNetwork(); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Joining the Kimono private mesh as an isolated service node.")
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	if err := m.Runner.RunSensitive("tailscale", "up", "--login-server", *serverURL, "--hostname", *machine, "--accept-dns=true", "--auth-key", key); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Connecting this VM to Cloudflare. Open the URL and select the domain when prompted.")
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	if err := m.Runner.Run("cloudflared", "tunnel", "login"); err != nil {
		return err
	}

	name := "kimono-" + *machine
	if err := m.Runner.Run("cloudflared", "tunnel", "create", name); err != nil {
		return err
	}
	id, err := m.findTunnel(name)
	if err != nil {
		return err
	}
	credentialSource, err := findCloudflareFile(id + ".json")
	if err != nil {
		return err
	}
	certificate, err := findCloudflareFile("cert.pem")
	if err != nil {
		return err
	}
	credentialDestination := filepath.Join(m.cloudflaredDir(), "credentials.json")
	if err := system.CopyFile(credentialSource, credentialDestination, 0600); err != nil {
		return err
	}
	config := Config{
		Version: 1, ServerURL: *serverURL, Domain: *domain, Machine: *machine,
		TunnelID: id, TunnelName: name, CertificatePath: certificate,
		CredentialsPath: credentialDestination, Exposures: map[string]Exposure{},
	}
	if err := m.save(config); err != nil {
		return err
	}
	if err := m.renderTunnel(config); err != nil {
		return err
	}
	if err := m.restartTunnel(config); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "\nKimono node installed.")
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Private mesh: %s\n", config.ServerURL)
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Public domain: %s\n", config.Domain)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Try: kimono expose <container>:<port>")
	return nil
}

func validateEnrollmentKey(key string) error {
	if !strings.HasPrefix(key, "hskey-auth-") || len(key) < 24 {
		return errors.New("invalid Kimono enrollment key; create a new one with `sudo kimono server enrollment create`")
	}
	return nil
}

func (m *Manager) ensurePackages() error {
	if !m.Runner.Exists("apt-get") {
		return errors.New("automatic node provisioning currently supports Ubuntu/Debian only")
	}
	if !m.Runner.Exists("docker") {
		if err := m.Runner.Run("apt-get", "update"); err != nil {
			return err
		}
		if err := m.Runner.Run("apt-get", "install", "-y", "docker.io", "docker-compose-v2", "curl", "ca-certificates"); err != nil {
			return err
		}
	}
	if m.Runner.Exists("systemctl") {
		if err := m.Runner.Run("systemctl", "enable", "--now", "docker"); err != nil {
			return err
		}
	}
	if !m.Runner.Exists("tailscale") {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Installing Tailscale from its official installer…")
		if err := m.Runner.Run("sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"); err != nil {
			return err
		}
	}
	if m.Runner.Exists("systemctl") {
		if err := m.Runner.Run("systemctl", "enable", "--now", "tailscaled"); err != nil {
			return err
		}
	}
	if !m.Runner.Exists("cloudflared") {
		arch := map[string]string{"amd64": "amd64", "arm64": "arm64"}[runtime.GOARCH]
		if arch == "" {
			return fmt.Errorf("automatic cloudflared installation does not support %s", runtime.GOARCH)
		}
		path := filepath.Join(os.TempDir(), "kimono-cloudflared.deb")
		url := "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-" + arch + ".deb"
		if err := download(url, path); err != nil {
			return err
		}
		defer os.Remove(path)
		if err := m.Runner.Run("dpkg", "-i", path); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) expose(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node expose", flag.ContinueOnError)
	nameFlag := flags.String("name", "", "application name")
	hostFlag := flags.String("hostname", "", "complete public hostname")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 1 {
		return errors.New("usage: kimono expose [--name NAME] [--hostname HOST] <container:port|port>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	exposure, err := parseTarget(flags.Arg(0))
	if err != nil {
		return err
	}
	if *nameFlag != "" {
		exposure.Name = slug(*nameFlag)
	}
	if exposure.Name == "" {
		return errors.New("application name is required for host ports; use --name")
	}
	if *hostFlag == "" {
		exposure.Hostname = exposure.Name + "-" + config.Machine + "." + config.Domain
	} else {
		exposure.Hostname = strings.ToLower(strings.TrimSpace(*hostFlag))
	}
	if !validHostname(exposure.Hostname) {
		return fmt.Errorf("invalid hostname %q", exposure.Hostname)
	}
	if _, exists := config.Exposures[exposure.Name]; exists {
		return fmt.Errorf("%q is already exposed; unexpose it first", exposure.Name)
	}
	if exposure.Kind == "docker" {
		if err := m.connectContainer(exposure.Target); err != nil {
			return err
		}
	}
	if err := m.Runner.Run("cloudflared", "tunnel", "--origincert", config.CertificatePath, "route", "dns", config.TunnelID, exposure.Hostname); err != nil {
		return err
	}
	config.Exposures[exposure.Name] = exposure
	if err := m.save(config); err != nil {
		return err
	}
	if err := m.renderTunnel(config); err != nil {
		return err
	}
	if err := m.restartTunnel(config); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "\nApplication exposed.\n\nURL:\nhttps://%s\n\nStatus:\nOnline\n", exposure.Hostname)
	return nil
}

func (m *Manager) unexpose(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if len(args) != 1 {
		return errors.New("usage: kimono unexpose <name>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	name := slug(args[0])
	exposure, ok := config.Exposures[name]
	if !ok {
		return fmt.Errorf("no exposure named %q", name)
	}
	delete(config.Exposures, name)
	if err := m.save(config); err != nil {
		return err
	}
	if err := m.renderTunnel(config); err != nil {
		return err
	}
	if err := m.restartTunnel(config); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "%s is no longer routed. The Cloudflare DNS record for %s remains reserved and can be removed in the Cloudflare dashboard.\n", name, exposure.Hostname)
	return nil
}

func (m *Manager) list() error {
	config, err := m.load()
	if err != nil {
		return err
	}
	if len(config.Exposures) == 0 {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "No applications exposed.")
		return nil
	}
	names := sortedExposureNames(config)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "NAME\tTARGET\tURL")
	for _, name := range names {
		exposure := config.Exposures[name]
		_, _ = fmt.Fprintf(m.Runner.Stdout, "%s\t%s\thttps://%s\n", exposure.Name, exposure.Target, exposure.Hostname)
	}
	return nil
}

func (m *Manager) inspect(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: kimono inspect <name>")
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	exposure, ok := config.Exposures[slug(args[0])]
	if !ok {
		return fmt.Errorf("no exposure named %q", args[0])
	}
	data, _ := json.MarshalIndent(exposure, "", "  ")
	_, _ = fmt.Fprintln(m.Runner.Stdout, string(data))
	return nil
}

func (m *Manager) status() error {
	config, err := m.load()
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Kimono node: %s\nMesh: %s\nTunnel: %s\nExposures: %d\n\n", config.Machine, config.ServerURL, config.TunnelName, len(config.Exposures))
	if err := m.Runner.Run("tailscale", "status"); err != nil {
		return err
	}
	return m.Runner.Run("docker", "ps", "--filter", "name="+tunnelName, "--format", "table {{.Names}}\t{{.Status}}")
}

func (m *Manager) doctor() error {
	failures := 0
	check := func(ok bool, message string) {
		mark := "✓"
		if !ok {
			mark = "✗"
			failures++
		}
		_, _ = fmt.Fprintf(m.Runner.Stdout, "%s %s\n", mark, message)
	}
	check(m.Runner.Exists("docker"), "Docker installed")
	check(m.Runner.Exists("tailscale"), "Tailscale installed")
	check(m.Runner.Exists("cloudflared"), "cloudflared installed")
	_, configErr := m.load()
	check(configErr == nil, "Kimono node configured")
	if m.Runner.Exists("docker") {
		_, err := m.Runner.Output("docker", "network", "inspect", networkName)
		check(err == nil, "kimono-web network present")
		_, err = m.Runner.Output("docker", "inspect", tunnelName)
		check(err == nil, "Cloudflare tunnel container present")
	}
	if m.Runner.Exists("tailscale") {
		_, err := m.Runner.Output("tailscale", "status", "--json")
		check(err == nil, "private mesh reachable")
	}
	if failures > 0 {
		return fmt.Errorf("doctor found %d problem(s)", failures)
	}
	return nil
}

func (m *Manager) connectContainer(name string) error {
	output, err := m.Runner.Output("docker", "inspect", "-f", "{{json .NetworkSettings.Networks}}", name)
	if err != nil {
		return fmt.Errorf("container %q is not running or does not exist: %w", name, err)
	}
	if strings.Contains(string(output), `"`+networkName+`"`) {
		return nil
	}
	return m.Runner.Run("docker", "network", "connect", networkName, name)
}

func (m *Manager) ensureNetwork() error {
	if _, err := m.Runner.Output("docker", "network", "inspect", networkName); err == nil {
		return nil
	}
	return m.Runner.Run("docker", "network", "create", networkName)
}

func (m *Manager) restartTunnel(config Config) error {
	if _, err := m.Runner.Output("docker", "inspect", tunnelName); err == nil {
		if err := m.Runner.Run("docker", "rm", "-f", tunnelName); err != nil {
			return err
		}
	}
	return m.Runner.Run("docker", "run", "-d", "--name", tunnelName, "--restart", "unless-stopped", "--network", networkName,
		"--add-host", "host.docker.internal:host-gateway", "-v", m.cloudflaredDir()+":/etc/cloudflared:ro",
		"cloudflare/cloudflared:latest", "tunnel", "--no-autoupdate", "--config", "/etc/cloudflared/config.yml", "run")
}

func (m *Manager) renderTunnel(config Config) error {
	var builder strings.Builder
	fmt.Fprintf(&builder, "tunnel: %s\ncredentials-file: /etc/cloudflared/credentials.json\nno-autoupdate: true\n\ningress:\n", config.TunnelID)
	for _, name := range sortedExposureNames(config) {
		exposure := config.Exposures[name]
		fmt.Fprintf(&builder, "  - hostname: %s\n    service: %s\n", exposure.Hostname, exposure.Service)
	}
	builder.WriteString("  - service: http_status:404\n")
	if err := os.MkdirAll(m.cloudflaredDir(), 0700); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.cloudflaredDir(), "config.yml"), []byte(builder.String()), 0600)
}

func (m *Manager) findTunnel(name string) (string, error) {
	output, err := m.Runner.Output("cloudflared", "tunnel", "list", "--output", "json")
	if err != nil {
		return "", err
	}
	var tunnels []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(output, &tunnels); err != nil {
		return "", fmt.Errorf("parse cloudflared tunnel list: %w", err)
	}
	for _, tunnel := range tunnels {
		if tunnel.Name == name {
			return tunnel.ID, nil
		}
	}
	return "", fmt.Errorf("cloudflared created %q but it was not returned by tunnel list", name)
}

func (m *Manager) load() (Config, error) {
	var config Config
	if err := system.ReadJSON(m.configPath(), &config); err != nil {
		return config, fmt.Errorf("Kimono node is not installed; run `sudo kimono node install`: %w", err)
	}
	if config.Exposures == nil {
		config.Exposures = map[string]Exposure{}
	}
	return config, nil
}

func (m *Manager) save(config Config) error {
	return system.WriteJSON(m.configPath(), config, 0600)
}

func (m *Manager) configPath() string     { return filepath.Join(m.Home, "node.json") }
func (m *Manager) cloudflaredDir() string { return filepath.Join(m.Home, "cloudflared") }

func parseTarget(value string) (Exposure, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return Exposure{}, errors.New("target is required")
	}
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
	if value == "" || value[0] == '-' || value[0] == '.' || value[0] == '_' {
		return false
	}
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' || character == '.' {
			continue
		}
		return false
	}
	return true
}

func validPort(value string) (string, error) {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return "", fmt.Errorf("invalid port %q", value)
	}
	return strconv.Itoa(port), nil
}

func slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	dash := false
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			builder.WriteRune(character)
			dash = false
		} else if builder.Len() > 0 && !dash {
			builder.WriteByte('-')
			dash = true
		}
	}
	return strings.Trim(builder.String(), "-")
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

func sortedExposureNames(config Config) []string {
	names := make([]string, 0, len(config.Exposures))
	for name := range config.Exposures {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func findCloudflareFile(name string) (string, error) {
	candidates := []string{}
	if home, err := os.UserHomeDir(); err == nil {
		candidates = append(candidates, filepath.Join(home, ".cloudflared", name))
	}
	candidates = append(candidates, filepath.Join("/root/.cloudflared", name))
	for _, path := range candidates {
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("could not find cloudflared %s; looked in %s", name, strings.Join(candidates, ", "))
}

func download(url, path string) error {
	client := &http.Client{Timeout: 5 * time.Minute}
	response, err := client.Get(url)
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

func prompt(reader *bufio.Reader, writer io.Writer, label, fallback string) string {
	if fallback == "" {
		_, _ = fmt.Fprintf(writer, "%s: ", label)
	} else {
		_, _ = fmt.Fprintf(writer, "%s [%s]: ", label, fallback)
	}
	value, _ := reader.ReadString('\n')
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}
