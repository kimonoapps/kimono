package node

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/sandbox"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

const (
	sandboxesKeyPath  = "/etc/kimono/sandboxes.key"
	sandboxesUnitPath = "/etc/systemd/system/kimono-sandboxes.service"
	dockerDaemonPath  = "/etc/docker/daemon.json"
	sandboxesPort     = "7480"
	sandboxesStateDir = "/var/lib/kimono/sandboxes"
	previewsDir       = "/etc/kimono/previews"
	previewsTunnel    = "kimono-previews-tunnel"
	previewsListen    = "127.0.0.1:7482"
	// cloudflaredImage runs the previews tunnel; pinned like everything else.
	cloudflaredImage = "cloudflare/cloudflared:2024.11.1"
)

const sandboxesUsage = "usage: kimono node sandboxes <enable|serve|status|disable>"

// sandboxes runs Kimono Code's sandboxes on this hosting node.
func (m *Manager) sandboxes(args []string) error {
	if len(args) == 0 {
		return errors.New(sandboxesUsage)
	}
	switch args[0] {
	case "enable":
		return m.sandboxesEnable(args[1:])
	case "serve":
		return m.sandboxesServe(args[1:])
	case "status":
		return m.sandboxesStatus(args[1:])
	case "disable":
		return m.sandboxesDisable(args[1:])
	default:
		return fmt.Errorf("unknown node sandboxes command %q; %s", args[0], sandboxesUsage)
	}
}

// gvisorScript adds gVisor's apt repository and installs runsc.
const gvisorScript = `set -e
command -v runsc >/dev/null 2>&1 && exit 0
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg
curl -fsSL https://gvisor.dev/archive.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
apt-get update -qq
apt-get install -y -qq runsc`

func (m *Manager) sandboxesEnable(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	if runtime.GOOS != "linux" {
		return errors.New("sandboxes run on a Linux hosting node")
	}
	flags := flag.NewFlagSet("node sandboxes enable", flag.ContinueOnError)
	listen := flags.String("listen", "", "API address, normally this node's mesh IP and port "+sandboxesPort)
	image := flags.String("image", sandbox.DefaultImage, "sandbox image")
	previewDomain := flags.String("preview-domain", "", "domain whose subdomains open previews, such as example.dev (one wildcard DNS record on Cloudflare)")
	var allowPrivate cidrList
	flags.Var(&allowPrivate, "allow-private", "a private network sandboxes may still reach, such as a LAN package mirror (repeatable)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if !m.Runner.Exists("iptables") {
		return errors.New("sandboxes need iptables to keep them off this node's private networks; install it first (apt-get install iptables)")
	}
	domain := strings.Trim(strings.ToLower(strings.TrimSpace(*previewDomain)), ".")
	if domain != "" && !validHostname(domain) {
		return fmt.Errorf("invalid preview domain %q", domain)
	}
	if !m.Runner.Exists("docker") {
		return errors.New("install Docker on this node first")
	}
	address := strings.TrimSpace(*listen)
	if address == "" {
		ip, err := m.meshIPv4()
		if err != nil {
			return fmt.Errorf("%w; join the Kimono mesh first or pass --listen", err)
		}
		address = ip + ":" + sandboxesPort
	}

	_, _ = fmt.Fprintln(m.Runner.Stdout, "Installing gVisor…")
	if err := m.Runner.Run("sh", "-c", gvisorScript); err != nil {
		return err
	}
	runsc, err := m.Runner.Output("sh", "-c", "command -v runsc")
	if err != nil {
		return err
	}
	changed, err := registerRunsc(dockerDaemonPath, strings.TrimSpace(string(runsc)))
	if err != nil {
		return err
	}
	if changed {
		if err := m.Runner.Run("systemctl", "restart", "docker"); err != nil {
			return err
		}
	}

	key, err := sandboxesKey()
	if err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if domain != "" {
		if err := m.setupPreviews(domain); err != nil {
			return err
		}
	}
	if err := os.WriteFile(sandboxesUnitPath, []byte(sandboxesUnit(executable, address, *image, domain, allowPrivate...)), 0644); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Pulling the sandbox image…")
	if err := m.Runner.Run("docker", "pull", *image); err != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "Couldn't pull %s yet; the first workspace will try again.\n", *image)
	}
	for _, step := range [][]string{{"daemon-reload"}, {"enable", "kimono-sandboxes"}, {"restart", "kimono-sandboxes"}} {
		if err := m.Runner.Run("systemctl", step...); err != nil {
			return err
		}
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "\nSandboxes are running. In Kimono Code's settings, enter:")
	_, _ = fmt.Fprintf(m.Runner.Stdout, "  Sandbox address  http://%s\n", address)
	_, _ = fmt.Fprintf(m.Runner.Stdout, "  Sandbox key      %s\n", key)
	if domain != "" {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "\nPreviews open at https://<name>.%s\n", domain)
	}
	return nil
}

// setupPreviews gives previews their own Cloudflare tunnel, whose only rule
// sends everything to the preview proxy, and one wildcard DNS record pointing
// at it. That record is the only DNS change previews ever make: a new preview
// is just a name the proxy starts answering for.
func (m *Manager) setupPreviews(domain string) error {
	if err := m.ensureExposurePackages(); err != nil {
		return err
	}
	certificate, err := findCloudflareFile("cert.pem")
	if err != nil {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Open the Cloudflare URL to let this node manage previews for "+domain+".")
		if err := m.Runner.Run("cloudflared", "tunnel", "login"); err != nil {
			return err
		}
		if certificate, err = findCloudflareFile("cert.pem"); err != nil {
			return err
		}
	}
	name := "kimono-previews-" + m.machineName()
	id, err := m.findExposureTunnel(name)
	if err != nil {
		if err := m.Runner.Run("cloudflared", "tunnel", "--origincert", certificate, "create", name); err != nil {
			return err
		}
		if id, err = m.findExposureTunnel(name); err != nil {
			return err
		}
	}
	credential, err := findCloudflareFile(id + ".json")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(previewsDir, 0700); err != nil {
		return err
	}
	if err := system.CopyFile(credential, filepath.Join(previewsDir, "credentials.json"), 0600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(previewsDir, "config.yml"), []byte(previewsTunnelConfig(id)), 0600); err != nil {
		return err
	}
	wildcard := "*." + domain
	if err := m.Runner.Run("cloudflared", "tunnel", "--origincert", certificate, "route", "dns", id, wildcard); err != nil {
		return fmt.Errorf("point %s at the previews tunnel: %w (if a %s record already exists, remove it in Cloudflare and run this again)", wildcard, err, wildcard)
	}
	if _, err := m.Runner.Output("docker", "inspect", previewsTunnel); err == nil {
		if err := m.Runner.Run("docker", "rm", "-f", previewsTunnel); err != nil {
			return err
		}
	}
	// Host networking lets the tunnel reach the proxy on loopback, so the proxy
	// listens nowhere else.
	return m.Runner.Run("docker", "run", "-d", "--name", previewsTunnel, "--restart", "unless-stopped", "--network", "host",
		"-v", previewsDir+":/etc/cloudflared:ro", cloudflaredImage, "tunnel", "--no-autoupdate", "--config", "/etc/cloudflared/config.yml", "run")
}

// previewsTunnelConfig sends every hostname the tunnel receives to the preview proxy.
func previewsTunnelConfig(tunnelID string) string {
	return fmt.Sprintf("tunnel: %s\ncredentials-file: /etc/cloudflared/credentials.json\nno-autoupdate: true\n\ningress:\n  - service: http://%s\n", tunnelID, previewsListen)
}

func (m *Manager) machineName() string {
	if config, err := m.loadOptional(); err == nil && config.Machine != "" {
		return slug(config.Machine)
	}
	if host, err := os.Hostname(); err == nil && slug(host) != "" {
		return slug(host)
	}
	return "node"
}

func (m *Manager) meshIPv4() (string, error) {
	if !m.Runner.Exists("tailscale") {
		return "", errors.New("this node isn't on the Kimono mesh")
	}
	out, err := m.Runner.Output("tailscale", "ip", "-4")
	if err != nil {
		return "", err
	}
	ip := strings.TrimSpace(strings.SplitN(string(out), "\n", 2)[0])
	if ip == "" {
		return "", errors.New("this node has no mesh address")
	}
	return ip, nil
}

// registerRunsc adds gVisor to Docker's runtimes, keeping every other setting.
func registerRunsc(path, runsc string) (bool, error) {
	settings := map[string]any{}
	if data, err := os.ReadFile(path); err == nil {
		if len(strings.TrimSpace(string(data))) > 0 {
			if err := json.Unmarshal(data, &settings); err != nil {
				return false, fmt.Errorf("%s isn't valid JSON: %w", path, err)
			}
		}
	} else if !os.IsNotExist(err) {
		return false, err
	}
	runtimes, _ := settings["runtimes"].(map[string]any)
	if runtimes == nil {
		runtimes = map[string]any{}
	}
	if existing, ok := runtimes["runsc"].(map[string]any); ok && existing["path"] == runsc {
		return false, nil
	}
	runtimes["runsc"] = map[string]any{"path": runsc}
	settings["runtimes"] = runtimes
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return false, err
	}
	return true, os.WriteFile(path, append(data, '\n'), 0644)
}

// sandboxesKey returns the node key, making it the first time.
func sandboxesKey() (string, error) {
	if data, err := os.ReadFile(sandboxesKeyPath); err == nil && len(strings.TrimSpace(string(data))) >= 32 {
		return strings.TrimSpace(string(data)), nil
	}
	key, err := system.RandomHex(32)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(sandboxesKeyPath), 0700); err != nil {
		return "", err
	}
	return key, os.WriteFile(sandboxesKeyPath, []byte(key+"\n"), 0600)
}

func sandboxesUnit(executable, address, image, previewDomain string, allowPrivate ...string) string {
	preview := ""
	if previewDomain != "" {
		preview = " --preview-domain " + previewDomain
	}
	for _, cidr := range allowPrivate {
		preview += " --allow-private " + cidr
	}
	return fmt.Sprintf(`[Unit]
Description=Kimono Code sandboxes
After=network-online.target docker.service tailscaled.service
Wants=network-online.target
Requires=docker.service

[Service]
ExecStart=%s node sandboxes serve --listen %s --key-file %s --image %s --state-dir %s%s
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
`, executable, address, sandboxesKeyPath, image, sandboxesStateDir, preview)
}

func (m *Manager) sandboxesServe(args []string) error {
	flags := flag.NewFlagSet("node sandboxes serve", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:"+sandboxesPort, "API address")
	keyFile := flags.String("key-file", sandboxesKeyPath, "file holding the node key")
	image := flags.String("image", envOr("KIMONO_SANDBOX_IMAGE", sandbox.DefaultImage), "sandbox image")
	gatewayListen := flags.String("gateway-listen", "", "model gateway and Git broker address (default: the sandbox network's gateway)")
	gatewayURL := flags.String("gateway-url", "", "that address as containers reach it (default: derived)")
	runtimeName := flags.String("runtime", "", "container runtime (default: runsc when installed)")
	cpus := flags.String("cpus", "4", "CPUs per sandbox")
	memory := flags.String("memory", "8g", "memory per sandbox")
	pids := flags.Int("pids", 2048, "processes per sandbox")
	pauseAfter := flags.Duration("pause-after", time.Minute, "pause a sandbox after this long without use (it resumes instantly)")
	stopAfter := flags.Duration("stop-after", 15*time.Minute, "stop a sandbox after this long without use (frees its memory; files kept)")
	removeAfter := flags.Duration("remove-after", 7*24*time.Hour, "remove a sandbox's container after this long without use (files kept on its volume; 0 never)")
	stateDir := flags.String("state-dir", sandboxesStateDir, "directory for what survives a restart (live previews)")
	previewListen := flags.String("preview-listen", previewsListen, "preview proxy address")
	previewDomain := flags.String("preview-domain", "", "domain whose subdomains open previews (empty: http://<name>.localhost:<port>)")
	devGitDir := flags.String("dev-git-dir", "", "development only: serve bare repositories under this directory as http://"+sandbox.DevGitHost+"/OWNER/NAME.git")
	var allowPrivate cidrList
	flags.Var(&allowPrivate, "allow-private", "a private network sandboxes may still reach, such as a LAN package mirror (repeatable)")
	allowOpen := flags.Bool("allow-open-network", false, "development only: run sandboxes without the firewall")
	dns := flags.String("dns", "1.1.1.1,9.9.9.9", "resolvers sandboxes use behind the firewall")
	if err := flags.Parse(args); err != nil {
		return err
	}
	key, err := os.ReadFile(*keyFile)
	if err != nil {
		return fmt.Errorf("read the node key: %w", err)
	}
	if *devGitDir != "" {
		if *devGitDir, err = filepath.Abs(*devGitDir); err != nil {
			return err
		}
	}
	logger := log.New(m.Runner.Stderr, "", log.LstdFlags)
	server, err := sandbox.New(sandbox.Config{
		Listen: *listen, Key: strings.TrimSpace(string(key)), Image: *image,
		GatewayListen: *gatewayListen, GatewayURL: *gatewayURL, Runtime: *runtimeName,
		CPUs: *cpus, Memory: *memory, Pids: *pids, PauseAfter: *pauseAfter, StopAfter: *stopAfter, RemoveAfter: *removeAfter,
		Agent: os.Getenv("KIMONO_SANDBOX_AGENT"), DevGitDir: *devGitDir,
		StateDir: *stateDir, PreviewListen: *previewListen, PreviewDomain: *previewDomain,
		AllowPrivate: allowPrivate, AllowOpenNetwork: *allowOpen, DNS: splitList(*dns),
		Logf: logger.Printf,
	})
	if err != nil {
		return err
	}
	if *devGitDir != "" {
		logger.Printf("development: serving repositories from %s as http://%s/", *devGitDir, sandbox.DevGitHost)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return server.Run(ctx)
}

func (m *Manager) sandboxesStatus(args []string) error {
	flags := flag.NewFlagSet("node sandboxes status", flag.ContinueOnError)
	stateDir := flags.String("state-dir", sandboxesStateDir, "the node's state directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if m.Runner.Exists("systemctl") {
		_ = m.Runner.Run("systemctl", "--no-pager", "--lines", "5", "status", "kimono-sandboxes")
		_, _ = fmt.Fprintln(m.Runner.Stdout)
	}
	_, why := sandbox.FirewallInPlace(context.Background(), "docker", "kimono-sandboxes")
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Firewall: %s\n\n", why)
	rows, err := sandbox.Status(context.Background(), "docker", *stateDir)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "No sandboxes.")
		return nil
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "WORKSPACE\tREPOSITORY\tSTATE\tQUIET FOR")
	for _, row := range rows {
		quiet := "-"
		if row.Quiet > 0 {
			quiet = row.Quiet.Round(time.Second).String()
		}
		_, _ = fmt.Fprintf(m.Runner.Stdout, "%s\t%s\t%s\t%s\n", row.ID, row.Repo, row.State, quiet)
	}
	return nil
}

func (m *Manager) sandboxesDisable(args []string) error {
	if err := system.RequireRoot(); err != nil {
		return err
	}
	flags := flag.NewFlagSet("node sandboxes disable", flag.ContinueOnError)
	remove := flags.Bool("remove", false, "also delete every sandbox and its files")
	if err := flags.Parse(args); err != nil {
		return err
	}
	_ = m.Runner.Run("systemctl", "disable", "--now", "kimono-sandboxes")
	_ = m.Runner.Run("sh", "-c", "docker rm -f "+previewsTunnel+" >/dev/null 2>&1 || true")
	_ = os.Remove(sandboxesUnitPath)
	_ = m.Runner.Run("systemctl", "daemon-reload")
	sandbox.RemoveFirewall(context.Background())
	if *remove {
		script := `docker ps -aq --filter label=kimono.sandbox | xargs -r docker rm -f -v
docker volume ls -q --filter label=kimono.sandbox | xargs -r docker volume rm -f
docker network rm kimono-sandboxes 2>/dev/null || true`
		if err := m.Runner.Run("sh", "-c", script); err != nil {
			return err
		}
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Sandboxes are off and every sandbox is deleted.")
		return nil
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Sandboxes are off. Existing sandboxes are kept; pass --remove to delete them.")
	return nil
}

// cidrList is a repeatable flag of networks.
type cidrList []string

func (l *cidrList) String() string { return strings.Join(*l, ",") }
func (l *cidrList) Set(value string) error {
	value = strings.TrimSpace(value)
	if _, _, err := net.ParseCIDR(value); err != nil {
		return fmt.Errorf("%q isn't a network such as 192.168.1.0/24", value)
	}
	*l = append(*l, value)
	return nil
}

func splitList(value string) []string {
	var out []string
	for _, item := range strings.Split(value, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
