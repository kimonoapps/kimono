package node

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"net/mail"
	"os"
	"path/filepath"
	"strings"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

const hostingRenewalHook = "/etc/letsencrypt/renewal-hooks/deploy/kimono-restart-wings"

type HostingConfig struct {
	Hostname    string `json:"hostname"`
	Port        int    `json:"port"`
	Challenge   string `json:"challenge"`
	Certificate string `json:"certificate"`
	PrivateKey  string `json:"private_key"`
}

type hostingTLSOptions struct {
	hostname            string
	email               string
	port                int
	challenge           string
	cloudflareTokenFile string
}

func (m *Manager) hosting(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: kimono node hosting tls [--hostname HOST] [--email EMAIL] [--port 8080] [--challenge http|cloudflare]")
	}
	switch args[0] {
	case "tls":
		return m.hostingTLS(args[1:])
	default:
		return fmt.Errorf("unknown node hosting command %q", args[0])
	}
}

func (m *Manager) hostingTLS(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node hosting tls", flag.ContinueOnError)
	hostname := flags.String("hostname", "", "public DNS name for this Wings node")
	email := flags.String("email", "", "Let's Encrypt account email")
	port := flags.Int("port", 8080, "public HTTPS port used by Wings")
	challenge := flags.String("challenge", "http", "certificate challenge: http or cloudflare")
	tokenFile := flags.String("cloudflare-token-file", "", "root-readable file containing a Cloudflare DNS API token")
	if err := flags.Parse(args); err != nil {
		return err
	}
	config, err := m.load()
	if err != nil {
		return err
	}
	reader := bufio.NewReader(m.Runner.Stdin)
	if *hostname == "" {
		*hostname = prompt(reader, m.Runner.Stdout, "Wings node hostname", "")
	}
	if *email == "" {
		*email = prompt(reader, m.Runner.Stdout, "Let's Encrypt email", "")
	}
	options := hostingTLSOptions{
		hostname: strings.Trim(strings.ToLower(strings.TrimSpace(*hostname)), "."),
		email:    strings.TrimSpace(*email), port: *port,
		challenge:           strings.ToLower(strings.TrimSpace(*challenge)),
		cloudflareTokenFile: strings.TrimSpace(*tokenFile),
	}
	if err := validateHostingTLS(options); err != nil {
		return err
	}
	if err := m.ensureCertbot(options.challenge); err != nil {
		return err
	}
	credentials := ""
	if options.challenge == "cloudflare" {
		credentials, err = m.writeCloudflareCredentials(options.cloudflareTokenFile)
		if err != nil {
			return err
		}
	}
	if err := m.Runner.Run("certbot", certbotArguments(options, credentials)...); err != nil {
		return err
	}
	if err := m.installHostingRenewalHook(); err != nil {
		return err
	}
	certificateDir := filepath.Join("/etc/letsencrypt/live", options.hostname)
	config.Version = 4
	config.Hosting = &HostingConfig{
		Hostname: options.hostname, Port: options.port, Challenge: options.challenge,
		Certificate: filepath.Join(certificateDir, "fullchain.pem"),
		PrivateKey:  filepath.Join(certificateDir, "privkey.pem"),
	}
	if err := m.save(config); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "\nHosting node TLS is ready.")
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Wings endpoint: https://%s:%d\n", config.Hosting.Hostname, config.Hosting.Port)
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Certificate: %s\nPrivate key: %s\n", config.Hosting.Certificate, config.Hosting.PrivateKey)
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Create the node manually in Pelican with HTTPS and port %d, then install its generated Wings configuration.\n", config.Hosting.Port)
	if options.challenge == "http" {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Keep TCP port 80 reachable for automatic certificate renewals; port 443 is not required.")
	} else {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Certificate renewal uses Cloudflare DNS and requires no inbound validation port.")
	}
	return nil
}

func validateHostingTLS(options hostingTLSOptions) error {
	if !validHostname(options.hostname) {
		return fmt.Errorf("invalid Wings hostname %q", options.hostname)
	}
	address, err := mail.ParseAddress(options.email)
	if err != nil || address.Address != options.email {
		return errors.New("a valid Let's Encrypt email is required")
	}
	if options.port < 1 || options.port > 65535 {
		return fmt.Errorf("invalid Wings port %d", options.port)
	}
	if options.challenge != "http" && options.challenge != "cloudflare" {
		return errors.New("challenge must be http or cloudflare")
	}
	if options.challenge == "cloudflare" && options.cloudflareTokenFile == "" {
		return errors.New("--cloudflare-token-file is required for the cloudflare challenge")
	}
	return nil
}

func (m *Manager) ensureCertbot(challenge string) error {
	if m.Runner.Exists("certbot") {
		if challenge != "cloudflare" {
			return nil
		}
		if status, err := m.Runner.Output("dpkg-query", "-W", "-f=${Status}", "python3-certbot-dns-cloudflare"); err == nil && strings.Contains(string(status), "install ok installed") {
			return nil
		}
	}
	if !m.Runner.Exists("apt-get") {
		return errors.New("automatic hosting certificate setup currently supports Ubuntu/Debian only")
	}
	if err := m.Runner.Run("apt-get", "update"); err != nil {
		return err
	}
	packages := []string{"install", "-y", "certbot"}
	if challenge == "cloudflare" {
		packages = append(packages, "python3-certbot-dns-cloudflare")
	}
	return m.Runner.Run("apt-get", packages...)
}

func (m *Manager) writeCloudflareCredentials(source string) (string, error) {
	info, err := os.Stat(source)
	if err != nil {
		return "", fmt.Errorf("read Cloudflare token file: %w", err)
	}
	if info.Mode().Perm()&0077 != 0 {
		return "", errors.New("Cloudflare token file must be readable only by root (mode 0600)")
	}
	token, err := os.ReadFile(source)
	if err != nil {
		return "", fmt.Errorf("read Cloudflare token file: %w", err)
	}
	value := strings.TrimSpace(string(token))
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return "", errors.New("Cloudflare token file must contain exactly one token")
	}
	directory := filepath.Join(m.Home, "hosting")
	if err := os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	destination := filepath.Join(directory, "cloudflare.ini")
	if err := os.WriteFile(destination, []byte("dns_cloudflare_api_token = "+value+"\n"), 0600); err != nil {
		return "", err
	}
	if err := os.Chmod(destination, 0600); err != nil {
		return "", err
	}
	return destination, nil
}

func certbotArguments(options hostingTLSOptions, credentials string) []string {
	arguments := []string{"certonly", "--non-interactive", "--agree-tos", "--keep-until-expiring", "--email", options.email, "--cert-name", options.hostname, "-d", options.hostname}
	if options.challenge == "cloudflare" {
		return append(arguments, "--dns-cloudflare", "--dns-cloudflare-credentials", credentials)
	}
	return append(arguments, "--standalone", "--preferred-challenges", "http")
}

func (m *Manager) installHostingRenewalHook() error {
	if m.Runner.DryRun {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "+ write Wings renewal hook %s\n", hostingRenewalHook)
		return nil
	}
	contents := "#!/bin/sh\nif command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet wings; then\n  systemctl restart wings\nfi\n"
	if err := os.MkdirAll(filepath.Dir(hostingRenewalHook), 0755); err != nil {
		return err
	}
	if err := os.WriteFile(hostingRenewalHook, []byte(contents), 0755); err != nil {
		return err
	}
	return os.Chmod(hostingRenewalHook, 0755)
}
