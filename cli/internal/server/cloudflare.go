package server

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/kimonoapps/kimono/cli/internal/clouddns"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

func (m *Manager) cloudflareDDNS(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: kimono server cloudflare-ddns <setup|run|status|remove>")
	}
	switch args[0] {
	case "setup":
		return m.setupCloudflareDDNS(args[1:])
	case "run":
		return m.runCloudflareDDNS()
	case "status":
		return m.Runner.Run("systemctl", "status", "--no-pager", "kimono-cloudflare-ddns.timer")
	case "remove":
		return m.removeCloudflareDDNS()
	default:
		return fmt.Errorf("unknown cloudflare-ddns command %q", args[0])
	}
}

func (m *Manager) setupCloudflareDDNS(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("server cloudflare-ddns setup", flag.ContinueOnError)
	zoneFlag := flags.String("zone", "", "Cloudflare DNS zone (normally example.com)")
	accountIDFlag := flags.String("account-id", "", "Cloudflare account ID for an account-owned token")
	tokenFile := flags.String("token-file", "", "read the API token from a root-only file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	identityDomain, meshDomain, portalDomain, err := m.configuredDomains()
	if err != nil {
		return err
	}
	token := ""
	accountID := strings.TrimSpace(*accountIDFlag)
	if *tokenFile != "" {
		data, readErr := os.ReadFile(*tokenFile)
		if readErr != nil {
			return readErr
		}
		token = strings.TrimSpace(string(data))
	} else {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Create a Cloudflare API token limited to this zone with Zone:Read and DNS:Edit permissions.")
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Account-owned tokens need the 32-character Account ID shown in the Cloudflare dashboard.")
		accountID, err = readLineFromTTY("Cloudflare account ID (leave blank for a user-owned token): ")
		if err != nil {
			return err
		}
		token, err = readSecretFromTTY("Cloudflare API token: ")
		if err != nil {
			return err
		}
	}
	if token == "" {
		return errors.New("Cloudflare API token is required")
	}
	if accountID != "" && !validCloudflareID(accountID) {
		return errors.New("Cloudflare account ID must be exactly 32 hexadecimal characters")
	}
	client := clouddns.NewClient(token)
	if err := client.VerifyToken(accountID); err != nil {
		return fmt.Errorf("verify Cloudflare token: %w", err)
	}
	zone, err := client.FindZone(identityDomain, *zoneFlag, accountID)
	if err != nil {
		return err
	}
	config := clouddns.Config{Token: token, AccountID: accountID, ZoneID: zone.ID, ZoneName: zone.Name, Records: []string{identityDomain, meshDomain, portalDomain}}
	if err := system.WriteJSON(m.cloudflareConfigPath(), config, 0600); err != nil {
		return err
	}
	if err := m.updateCloudflareRecords(config); err != nil {
		return err
	}
	if err := m.installCloudflareTimer(); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Cloudflare Dynamic DNS is active and will check every five minutes.")
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Kimono's own records are managed as DNS-only A records; published apps use tunnel routes.")
	return nil
}

func (m *Manager) runCloudflareDDNS() error {
	var config clouddns.Config
	if err := system.ReadJSON(m.cloudflareConfigPath(), &config); err != nil {
		return fmt.Errorf("Cloudflare DDNS is not configured: %w", err)
	}
	return m.updateCloudflareRecords(config)
}

func (m *Manager) updateCloudflareRecords(config clouddns.Config) error {
	publicIP, err := discoverPublicIPv4()
	if err != nil {
		return err
	}
	client := clouddns.NewClient(config.Token)
	for _, record := range config.Records {
		changed, updateErr := client.UpsertA(config.ZoneID, record, publicIP)
		if updateErr != nil {
			return updateErr
		}
		if changed {
			_, _ = fmt.Fprintf(m.Runner.Stdout, "Updated %s -> %s (DNS only)\n", record, publicIP)
		} else {
			_, _ = fmt.Fprintf(m.Runner.Stdout, "%s already points to %s\n", record, publicIP)
		}
	}
	return nil
}

func (m *Manager) installCloudflareTimer() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if strings.ContainsAny(executable, " \t\n") {
		return errors.New("Kimono executable path contains whitespace and cannot be used in a systemd unit")
	}
	unitDir := os.Getenv("KIMONO_SYSTEMD_DIR")
	if unitDir == "" {
		unitDir = "/etc/systemd/system"
	}
	service := fmt.Sprintf(`[Unit]
Description=Update Kimono Cloudflare DNS records
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=%s server cloudflare-ddns run
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
`, executable)
	timer := `[Unit]
Description=Run Kimono Cloudflare Dynamic DNS

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
RandomizedDelaySec=30s
Persistent=true

[Install]
WantedBy=timers.target
`
	if err := os.WriteFile(filepath.Join(unitDir, "kimono-cloudflare-ddns.service"), []byte(service), 0644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(unitDir, "kimono-cloudflare-ddns.timer"), []byte(timer), 0644); err != nil {
		return err
	}
	if err := m.Runner.Run("systemctl", "daemon-reload"); err != nil {
		return err
	}
	return m.Runner.Run("systemctl", "enable", "--now", "kimono-cloudflare-ddns.timer")
}

func (m *Manager) removeCloudflareDDNS() error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if err := m.Runner.Run("systemctl", "disable", "--now", "kimono-cloudflare-ddns.timer"); err != nil {
		return err
	}
	unitDir := os.Getenv("KIMONO_SYSTEMD_DIR")
	if unitDir == "" {
		unitDir = "/etc/systemd/system"
	}
	for _, name := range []string{"kimono-cloudflare-ddns.service", "kimono-cloudflare-ddns.timer"} {
		if err := os.Remove(filepath.Join(unitDir, name)); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if err := os.Remove(m.cloudflareConfigPath()); err != nil && !os.IsNotExist(err) {
		return err
	}
	return m.Runner.Run("systemctl", "daemon-reload")
}

func readSecretFromTTY(label string) (string, error) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", errors.New("a terminal is required; use --token-file for unattended setup")
	}
	defer tty.Close()
	disableEcho := exec.Command("stty", "-echo")
	disableEcho.Stdin = tty
	if err := disableEcho.Run(); err != nil {
		return "", err
	}
	defer func() {
		enableEcho := exec.Command("stty", "echo")
		enableEcho.Stdin = tty
		_ = enableEcho.Run()
		_, _ = fmt.Fprintln(tty)
	}()
	_, _ = fmt.Fprint(tty, label)
	value, err := bufio.NewReader(tty).ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func readLineFromTTY(label string) (string, error) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return "", errors.New("a terminal is required; use --account-id and --token-file for unattended setup")
	}
	defer tty.Close()
	_, _ = fmt.Fprint(tty, label)
	value, err := bufio.NewReader(tty).ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func validCloudflareID(value string) bool {
	if len(value) != 32 {
		return false
	}
	for _, character := range value {
		if character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F' {
			continue
		}
		return false
	}
	return true
}

func (m *Manager) cloudflareConfigPath() string {
	return filepath.Join(m.Home, "cloudflare-ddns.json")
}
