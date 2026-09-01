package server

import (
	"bufio"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	kimono "github.com/kimonoapps/kimono"
	"github.com/kimonoapps/kimono/cli/internal/reconcile"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

type Manager struct {
	Runner *system.Runner
	Home   string
}

func New(runner *system.Runner) *Manager {
	return &Manager{Runner: runner, Home: system.Home()}
}

func (m *Manager) Execute(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: kimono server <install|start|stop|status|apply|doctor|enrollment|cloudflare-ddns|logs|update|backup>")
	}
	switch args[0] {
	case "install":
		return m.install(args[1:])
	case "start":
		return m.start(args[1:])
	case "stop":
		return m.compose("down")
	case "status":
		return m.compose("ps")
	case "apply":
		return m.apply(args[1:])
	case "doctor":
		return m.doctor()
	case "repair":
		return m.repair()
	case "enrollment":
		return m.enrollment(args[1:])
	case "cloudflare-ddns":
		return m.cloudflareDDNS(args[1:])
	case "logs":
		return m.logs(args[1:])
	case "update":
		return m.update()
	case "backup":
		return m.backup(args[1:])
	default:
		return fmt.Errorf("unknown server command %q", args[0])
	}
}

func (m *Manager) enrollment(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if len(args) == 0 || args[0] != "create" {
		return errors.New("usage: kimono server enrollment create [--role node|admin] [--expiration 10m]")
	}
	flags := flag.NewFlagSet("server enrollment create", flag.ContinueOnError)
	role := flags.String("role", "node", "enrollment role: node or admin")
	expiration := flags.String("expiration", "10m", "how long the single-use key remains valid")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	tag, err := enrollmentTag(*role)
	if err != nil {
		return err
	}
	if _, err := time.ParseDuration(*expiration); err != nil {
		return fmt.Errorf("invalid enrollment expiration %q: %w", *expiration, err)
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Creating a single-use %s enrollment key valid for %s.\n", *role, *expiration)
	if err := m.Runner.Run("docker", "exec", "kimono-server-headscale-1", "headscale", "preauthkeys", "create", "--expiration", *expiration, "--tags", tag); err != nil {
		return fmt.Errorf("create Headscale enrollment key: %w", err)
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Use the printed key once; Kimono will not be able to display it again.")
	return nil
}

func enrollmentTag(role string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "node":
		return "tag:kimono-node", nil
	case "admin":
		return "tag:kimono-admin", nil
	default:
		return "", fmt.Errorf("invalid enrollment role %q; use node or admin", role)
	}
}

func (m *Manager) install(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("server install", flag.ContinueOnError)
	domain := flags.String("domain", "", "base public domain (for example, kimonolabs.dev)")
	identityDomain := flags.String("identity-domain", "", "Authentik hostname")
	meshDomain := flags.String("mesh-domain", "", "Headscale hostname")
	portalDomain := flags.String("portal-domain", "", "Kimono Portal hostname")
	email := flags.String("email", "", "ACME account email")
	magicDNS := flags.String("magic-dns", "kimono.internal", "private MagicDNS suffix")
	noStart := flags.Bool("no-start", false, "write configuration without starting services")
	skipDNSCheck := flags.Bool("skip-dns-check", false, "start even when public DNS cannot be verified")
	force := flags.Bool("force", false, "replace an existing server configuration and its secrets")
	if err := flags.Parse(args); err != nil {
		return err
	}
	existingEnvironment := map[string]string{}
	if _, err := os.Stat(m.envPath()); err == nil {
		if !*force {
			return errors.New("Kimono server is already installed; use `kimono server update`, or pass --force to replace its configuration")
		}
		existingEnvironment, err = readServerEnvironment(m.envPath())
		if err != nil {
			return fmt.Errorf("read existing server secrets: %w", err)
		}
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Preserving existing database, Authentik, and OIDC secrets.")
	}

	reader := bufio.NewReader(m.Runner.Stdin)
	if *domain == "" && (*identityDomain == "" || *meshDomain == "") {
		*domain = prompt(reader, m.Runner.Stdout, "Public base domain", "")
	}
	*domain = strings.Trim(strings.ToLower(strings.TrimSpace(*domain)), ".")
	*identityDomain = qualifyHostname(*identityDomain, "accounts", *domain)
	*meshDomain = qualifyHostname(*meshDomain, "mesh", *domain)
	*portalDomain = qualifyHostname(*portalDomain, "kimono", *domain)
	if *email == "" {
		*email = prompt(reader, m.Runner.Stdout, "Certificate email", "")
	}
	for name, value := range map[string]string{"identity domain": *identityDomain, "mesh domain": *meshDomain, "portal domain": *portalDomain, "email": *email, "MagicDNS domain": *magicDNS} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}

	if err := m.ensureDocker(); err != nil {
		return err
	}
	if err := m.extractAppliance(); err != nil {
		return err
	}
	pgPass, err := preservedOrRandom(existingEnvironment, "PG_PASS", func() (string, error) { return system.RandomBase64(36) })
	if err != nil {
		return err
	}
	authSecret, err := preservedOrRandom(existingEnvironment, "AUTHENTIK_SECRET_KEY", func() (string, error) { return system.RandomBase64(60) })
	if err != nil {
		return err
	}
	oidcSecret, err := preservedOrRandom(existingEnvironment, "KIMONO_HEADSCALE_OIDC_CLIENT_SECRET", func() (string, error) { return system.RandomHex(32) })
	if err != nil {
		return err
	}
	portalOIDCSecret, err := preservedOrRandom(existingEnvironment, "KIMONO_PORTAL_OIDC_CLIENT_SECRET", func() (string, error) { return system.RandomHex(32) })
	if err != nil {
		return err
	}
	portalSessionSecret, err := preservedOrRandom(existingEnvironment, "KIMONO_PORTAL_SESSION_SECRET", func() (string, error) { return system.RandomBase64(48) })
	if err != nil {
		return err
	}
	env := fmt.Sprintf(`AUTHENTIK_DOMAIN=%s
KIMONO_BASE_DOMAIN=%s
MESH_DOMAIN=%s
KIMONO_PORTAL_DOMAIN=%s
MAGIC_DNS_DOMAIN=%s
ACME_EMAIL=%s

AUTHENTIK_TAG=2026.5.6
HEADSCALE_TAG=0.28.0
CADDY_TAG=2.10.2-alpine

PG_DB=authentik
PG_USER=authentik
PG_PASS=%s
AUTHENTIK_SECRET_KEY=%s

KIMONO_HEADSCALE_OIDC_CLIENT_ID=kimono-headscale
KIMONO_HEADSCALE_OIDC_CLIENT_SECRET=%s
KIMONO_HEADSCALE_OIDC_REDIRECT_URI=https://%s/oidc/callback
KIMONO_HEADSCALE_OIDC_ISSUER=https://%s/application/o/kimono-headscale/
HEADSCALE_NODE_EXPIRY=180d

KIMONO_PORTAL_OIDC_CLIENT_ID=kimono-portal
KIMONO_PORTAL_OIDC_CLIENT_SECRET=%s
KIMONO_PORTAL_OIDC_REDIRECT_URI=https://%s/api/auth/callback/authentik
KIMONO_PORTAL_SESSION_SECRET=%s
KIMONO_PORTAL_TAG=latest

KIMONO_RECONCILER_TAG=latest

KIMONO_BRAND_ASSET_PATH=%s
`, *identityDomain, *domain, *meshDomain, *portalDomain, *magicDNS, *email, pgPass, authSecret, oidcSecret, *meshDomain, *identityDomain, portalOIDCSecret, *portalDomain, portalSessionSecret,
		filepath.Join(m.serverDir(), "assets"))
	if err := os.WriteFile(m.envPath(), []byte(env), 0600); err != nil {
		return err
	}

	_, _ = fmt.Fprintf(m.Runner.Stdout, "\nKimono server configured in %s\n", m.serverDir())
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Portal:   https://%s\nIdentity: https://%s\nMesh:     https://%s\n\nPublish applications such as Notes from the Portal.\n\n", *portalDomain, *identityDomain, *meshDomain)
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Create DNS A records for all public names pointing directly to this VM's public IPv4.")
	_, _ = fmt.Fprintln(m.Runner.Stdout, "The mesh record must not use the Cloudflare proxy.")
	if *noStart {
		return nil
	}
	if !*skipDNSCheck {
		if err := m.checkDNS(*identityDomain, *meshDomain, *portalDomain); err != nil {
			_, _ = fmt.Fprintln(m.Runner.Stdout, "\nKimono has been configured but was not started.")
			_, _ = fmt.Fprintln(m.Runner.Stdout, "Fix the DNS records, wait for propagation, then run: sudo kimono server start")
			return err
		}
	} else {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "WARNING: DNS verification skipped; HTTPS certificates may fail.")
	}
	if err := m.compose("up", "-d", "--remove-orphans"); err != nil {
		return err
	}
	return m.bootstrapBlueprints()
}

// qualifyHostname accepts either a complete hostname or a short label. Short
// labels are placed below the configured Kimono base domain.
func qualifyHostname(value, fallback, baseDomain string) string {
	value = strings.Trim(strings.ToLower(strings.TrimSpace(value)), ".")
	baseDomain = strings.Trim(strings.ToLower(strings.TrimSpace(baseDomain)), ".")
	if value == "" {
		value = fallback
	}
	if value == "@" {
		return baseDomain
	}
	if strings.Contains(value, ".") || baseDomain == "" {
		return value
	}
	return value + "." + baseDomain
}

func (m *Manager) start(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("server start", flag.ContinueOnError)
	skipDNSCheck := flags.Bool("skip-dns-check", false, "start even when public DNS cannot be verified")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if err := m.ensureServerEnvironment(); err != nil {
		return err
	}
	if !*skipDNSCheck {
		identityDomain, meshDomain, portalDomain, err := m.configuredDomains()
		if err != nil {
			return err
		}
		if err := m.checkDNS(identityDomain, meshDomain, portalDomain); err != nil {
			return fmt.Errorf("DNS verification failed; fix DNS or use --skip-dns-check for an advanced setup: %w", err)
		}
	}
	return m.compose("up", "-d", "--remove-orphans")
}

func (m *Manager) doctor() error {
	identityDomain, meshDomain, portalDomain, err := m.configuredDomains()
	if err != nil {
		return err
	}
	if err := m.checkDNS(identityDomain, meshDomain, portalDomain); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "\nDNS is ready. Checking containers…")
	return m.compose("ps")
}

func (m *Manager) ensureDocker() error {
	if m.Runner.Exists("docker") {
		if _, err := m.Runner.Output("docker", "compose", "version"); err == nil {
			return nil
		}
	}
	if !m.Runner.Exists("apt-get") {
		return errors.New("Docker Compose is required; automatic installation currently supports Ubuntu/Debian only")
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Installing Docker and the Compose plugin…")
	if err := m.Runner.Run("apt-get", "update"); err != nil {
		return err
	}
	return m.Runner.Run("apt-get", "install", "-y", "docker.io", "docker-compose-v2")
}

func (m *Manager) extractAppliance() error {
	mappings := map[string]string{
		"infra/compose/server/compose.yml":                                 "compose.yml",
		"infra/compose/server/Caddyfile":                                   "Caddyfile",
		"infra/compose/server/authentik/blueprints/kimono-headscale.yaml":  "authentik/blueprints/kimono-headscale.yaml",
		"infra/compose/server/authentik/blueprints/kimono-enrollment.yaml": "authentik/blueprints/kimono-enrollment.yaml",
		"infra/compose/server/authentik/blueprints/kimono.css":             "authentik/blueprints/kimono.css",
		"infra/compose/server/authentik/certs/.gitkeep":                    "authentik/certs/.gitkeep",
		"infra/compose/server/authentik/custom-templates/.gitkeep":         "authentik/custom-templates/.gitkeep",
		"infra/compose/server/app-definitions/.gitkeep":                    "app-definitions/.gitkeep",
		"infra/compose/server/headscale/config.yaml.tmpl":                  "headscale/config.yaml.tmpl",
		"infra/compose/server/headscale/policy.hujson":                     "headscale/policy.hujson",
		"infra/compose/server/scripts/render-headscale-config.sh":          "scripts/render-headscale-config.sh",
		"apps/portal/public/kimono-sakura-mark.svg":                        "assets/kimono-sakura-mark.svg",
		"scripts/install.sh":                                               "assets/install.sh",
	}
	// Every brand asset ships, so adding a logo variant needs no CLI change.
	brand, err := fs.ReadDir(kimono.ApplianceFiles, "apps/portal/public/brand")
	if err != nil {
		return err
	}
	for _, entry := range brand {
		if entry.IsDir() {
			continue
		}
		mappings["apps/portal/public/brand/"+entry.Name()] = "assets/" + entry.Name()
	}
	for source, destination := range mappings {
		data, err := fs.ReadFile(kimono.ApplianceFiles, source)
		if err != nil {
			return err
		}
		path := filepath.Join(m.serverDir(), destination)
		if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
			return err
		}
		mode := os.FileMode(0644)
		if strings.HasSuffix(path, ".sh") {
			mode = 0755
		}
		// The embedded copy is a bootstrap default. Once the reconciler owns a
		// file, restoring the static one would undo live configuration — the
		// mesh policy is the case that matters, because it decides reachability.
		if generatedByKimono(path) {
			continue
		}
		if err := os.WriteFile(path, data, mode); err != nil {
			return err
		}
	}
	// Authentik and the Portal both run as non-root users. Bind-mounted
	// directories must therefore be traversable even when they are empty.
	for _, directory := range []string{
		filepath.Join(m.serverDir(), "authentik"),
		filepath.Join(m.serverDir(), "authentik", "custom-templates"),
		filepath.Join(m.serverDir(), "app-definitions"),
	} {
		if err := os.Chmod(directory, 0755); err != nil {
			return err
		}
	}
	return nil
}

func (m *Manager) repair() error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if err := m.extractAppliance(); err != nil {
		return err
	}
	if err := m.ensureServerEnvironment(); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Repaired embedded appliance files and container-readable permissions.")
	if err := m.compose("up", "-d", "--remove-orphans"); err != nil {
		return err
	}
	if err := m.reloadHeadscalePolicy(); err != nil {
		return err
	}
	if err := m.reloadCaddy(); err != nil {
		return err
	}
	if err := m.ensureMeshAPIKey(); err != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "warning: %s\n", err)
	} else if err := m.compose("up", "-d", "--no-deps", "portal"); err != nil {
		return err
	}
	return m.bootstrapBlueprints()
}

// generatedByKimono reports whether a file on disk was written by the
// reconciler rather than extracted from the embedded appliance.
func generatedByKimono(path string) bool {
	handle, err := os.Open(path)
	if err != nil {
		return false
	}
	defer handle.Close()
	header := make([]byte, 64)
	read, err := handle.Read(header)
	if err != nil && read == 0 {
		return false
	}
	return strings.Contains(string(header[:read]), "Generated by Kimono")
}

// checkedInBlueprints ship with the appliance rather than being generated per
// application. Authentik's discovery cycle does not instantiate blueprints in
// the Kimono directory, so every one of them is imported explicitly; a new
// file here is only live once it is listed.
var checkedInBlueprints = []string{
	"kimono/kimono-headscale.yaml",
	"kimono/kimono-enrollment.yaml",
}

func (m *Manager) bootstrapBlueprints() error {
	for _, blueprint := range checkedInBlueprints {
		command := reconcile.BlueprintApplyCommand(blueprint)
		if err := m.Runner.Run("docker", "exec", "kimono-server-authentik-worker-1", "ak", "shell", "-c", command); err != nil {
			return fmt.Errorf("create and apply Kimono Authentik blueprint %s: %w", blueprint, err)
		}
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Kimono Authentik blueprints applied.")
	return nil
}

func (m *Manager) logs(args []string) error {
	command := []string{"logs", "-f", "--tail", "200"}
	command = append(command, args...)
	return m.compose(command...)
}

func (m *Manager) update() error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if err := m.extractAppliance(); err != nil {
		return err
	}
	if err := m.ensureServerEnvironment(); err != nil {
		return err
	}
	// A locally loaded or not-yet-published image must not block the update;
	// Compose recreates from what the daemon already holds.
	if err := m.compose("pull", "--ignore-pull-failures"); err != nil {
		return err
	}
	if err := m.compose("up", "-d", "--remove-orphans"); err != nil {
		return err
	}
	if err := m.reloadHeadscalePolicy(); err != nil {
		return err
	}
	if err := m.reloadCaddy(); err != nil {
		return err
	}
	if err := m.ensureMeshAPIKey(); err != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "warning: %s\n", err)
	} else if err := m.compose("up", "-d", "--no-deps", "portal"); err != nil {
		return err
	}
	return m.bootstrapBlueprints()
}

func (m *Manager) reloadHeadscalePolicy() error {
	if err := m.compose("run", "--rm", "headscale-config"); err != nil {
		return fmt.Errorf("render Headscale access policy: %w", err)
	}
	if err := m.Runner.Run("docker", "kill", "--signal", "HUP", "kimono-server-headscale-1"); err != nil {
		return fmt.Errorf("reload Headscale access policy: %w", err)
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Headscale access policy reloaded.")
	return nil
}

func (m *Manager) reloadCaddy() error {
	if err := m.Runner.Run("docker", "exec", "kimono-server-caddy-1", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"); err != nil {
		return fmt.Errorf("reload Caddy routes: %w", err)
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Caddy routes reloaded.")
	return nil
}

func (m *Manager) backup(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	destination := ""
	if len(args) > 0 {
		destination = args[0]
	} else {
		destination = filepath.Join(m.Home, "backups", time.Now().UTC().Format("20060102-150405"))
	}
	abs, err := filepath.Abs(destination)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(abs, 0700); err != nil {
		return err
	}
	if err := m.compose("stop"); err != nil {
		return err
	}
	defer func() { _ = m.compose("up", "-d") }()
	volumes := []string{"authentik_database", "authentik_data", "headscale_data", "caddy_data", "outline_database", "outline_redis", "outline_data", "portal_config"}
	for _, volume := range volumes {
		fullName := "kimono-server_" + volume
		if err := m.Runner.Run("docker", "run", "--rm", "-v", fullName+":/source:ro", "-v", abs+":/backup", "alpine:3.22", "tar", "czf", "/backup/"+volume+".tgz", "-C", "/source", "."); err != nil {
			return err
		}
	}
	if err := system.CopyFile(m.envPath(), filepath.Join(abs, "server.env"), 0600); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Backup written to %s\n", abs)
	return nil
}

func (m *Manager) compose(args ...string) error {
	if _, err := os.Stat(m.envPath()); err != nil && !m.Runner.DryRun {
		return fmt.Errorf("Kimono server is not installed; run `sudo kimono server install`: %w", err)
	}
	base := []string{"compose", "--env-file", m.envPath(), "-f", filepath.Join(m.serverDir(), "compose.yml")}
	return m.Runner.Run("docker", append(base, args...)...)
}

func (m *Manager) serverDir() string { return filepath.Join(m.Home, "server") }
func (m *Manager) envPath() string   { return filepath.Join(m.Home, "server.env") }

func prompt(reader *bufio.Reader, writer interface{ Write([]byte) (int, error) }, label, fallback string) string {
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

func preservedOrRandom(environment map[string]string, key string, generate func() (string, error)) (string, error) {
	if value := environment[key]; value != "" {
		return value, nil
	}
	return generate()
}
