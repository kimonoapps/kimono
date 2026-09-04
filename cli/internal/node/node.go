package node

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

type Config struct {
	Version   int             `json:"version"`
	ServerURL string          `json:"server_url"`
	Machine   string          `json:"machine"`
	Exposure  *ExposureConfig `json:"exposure,omitempty"`
	Hosting   *HostingConfig  `json:"hosting,omitempty"`
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
		return errors.New("usage: kimono node <install|login|logout|status|doctor|hosting|expose|unexpose|list|inspect|logs>")
	}
	switch args[0] {
	case "install":
		return m.install(args[1:])
	case "login":
		return m.login(args[1:])
	case "logout":
		return m.Runner.Run("tailscale", "logout")
	case "status":
		return m.status()
	case "doctor":
		return m.doctor()
	case "hosting":
		return m.hosting(args[1:])
	case "expose":
		return m.expose(args[1:])
	case "unexpose":
		return m.unexpose(args[1:])
	case "list":
		return m.listExposures()
	case "inspect":
		return m.inspectExposure(args[1:])
	case "logs":
		return m.exposureLogs()
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
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Re-enrolling this client with the Kimono private mesh.")
	return m.Runner.RunSensitive("tailscale", "up", "--login-server", config.ServerURL, "--hostname", config.Machine, "--accept-dns=true", "--auth-key", key, "--force-reauth")
}

func (m *Manager) install(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node install", flag.ContinueOnError)
	serverURL := flags.String("server", "", "Kimono Headscale URL")
	machine := flags.String("name", "", "client name on the private mesh")
	authKey := flags.String("auth-key", "", "single-use key from `kimono server enrollment create`")
	skipPackages := flags.Bool("skip-packages", false, "do not install Tailscale")
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
	if *machine == "" {
		hostname, _ := os.Hostname()
		*machine = prompt(reader, m.Runner.Stdout, "Client name", slug(hostname))
	}
	*machine = slug(*machine)
	if *machine == "" {
		return errors.New("client name is required")
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
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Joining this client to the Kimono private mesh.")
	_, _ = fmt.Fprintln(m.Runner.Stdout)
	if err := m.Runner.RunSensitive("tailscale", "up", "--login-server", *serverURL, "--hostname", *machine, "--accept-dns=true", "--auth-key", key); err != nil {
		return err
	}
	config := Config{Version: 4, ServerURL: *serverURL, Machine: *machine}
	if err := m.save(config); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "\nKimono client node installed.")
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Private mesh: %s\n", config.ServerURL)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Application containers and tunnel connectors remain on the Kimono server.")
	return nil
}

func (m *Manager) ensurePackages() error {
	if !m.Runner.Exists("apt-get") {
		return errors.New("automatic client provisioning currently supports Ubuntu/Debian only")
	}
	if !m.Runner.Exists("curl") {
		if err := m.Runner.Run("apt-get", "update"); err != nil {
			return err
		}
		if err := m.Runner.Run("apt-get", "install", "-y", "curl", "ca-certificates"); err != nil {
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
		return m.Runner.Run("systemctl", "enable", "--now", "tailscaled")
	}
	return nil
}

func (m *Manager) status() error {
	config, err := m.load()
	if err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Kimono client: %s\nMesh: %s\n\n", config.Machine, config.ServerURL)
	if err := m.Runner.Run("tailscale", "status"); err != nil {
		return err
	}
	if config.Exposure != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "Convenience exposures: %d via %s\n", len(config.Exposure.Items), config.Exposure.Provider)
	}
	if config.Hosting != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "Hosting node: https://%s:%d (%s certificate)\n", config.Hosting.Hostname, config.Hosting.Port, config.Hosting.Challenge)
	}
	return nil
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
	check(m.Runner.Exists("tailscale"), "Tailscale installed")
	_, configErr := m.load()
	check(configErr == nil, "Kimono client configured")
	if m.Runner.Exists("tailscale") {
		_, err := m.Runner.Output("tailscale", "status", "--json")
		check(err == nil, "private mesh reachable")
	}
	if config, err := m.load(); err == nil && config.Hosting != nil {
		check(fileExists(config.Hosting.Certificate), "hosting certificate present")
		check(fileExists(config.Hosting.PrivateKey), "hosting certificate key present")
	}
	if failures > 0 {
		return fmt.Errorf("doctor found %d problem(s)", failures)
	}
	return nil
}

func (m *Manager) load() (Config, error) {
	var config Config
	if err := system.ReadJSON(m.configPath(), &config); err != nil {
		return config, fmt.Errorf("Kimono client is not installed; run `sudo kimono node install`: %w", err)
	}
	return config, nil
}

func (m *Manager) save(config Config) error { return system.WriteJSON(m.configPath(), config, 0600) }
func (m *Manager) configPath() string       { return filepath.Join(m.Home, "node.json") }

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func validateEnrollmentKey(key string) error {
	if !strings.HasPrefix(key, "hskey-auth-") || len(key) < 24 {
		return errors.New("invalid Kimono enrollment key; create a new one with `sudo kimono server enrollment create`")
	}
	return nil
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
