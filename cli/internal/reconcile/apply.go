package reconcile

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/clouddns"
	"github.com/kimonoapps/kimono/cli/internal/system"
)

const connectorImage = "cloudflare/cloudflared:2026.8.0"

// DefaultBlueprintContainerDir is where the appliance mounts the generated
// blueprint directory inside the Authentik containers.
const DefaultBlueprintContainerDir = "/blueprints/kimono"

// Paths locates the desired state the Portal publishes and the directories the
// reconciler owns.
type Paths struct {
	DeploymentDir string
	// CloudDNSConfig holds the Dynamic DNS credentials the appliance already
	// stores, reused to point directly published hostnames at it.
	CloudDNSConfig string
	Layout         Layout
	// BlueprintContainerDir is where BlueprintDir appears inside Authentik.
	// Blueprints are applied by path, so the reconciler needs the path the
	// worker sees rather than the one on the host.
	BlueprintContainerDir string
}

func (p Paths) PlanPath() string    { return filepath.Join(p.DeploymentDir, "plan.json") }
func (p Paths) SecretsPath() string { return filepath.Join(p.DeploymentDir, "secrets.env") }
func (p Paths) StatusPath() string  { return filepath.Join(p.DeploymentDir, "status.json") }

type Status struct {
	PlanDigest      string   `json:"planDigest"`
	State           string   `json:"state"`
	Message         string   `json:"message"`
	UpdatedAt       string   `json:"updatedAt"`
	AppliedServices []string `json:"appliedServices,omitempty"`
	FailedActions   []string `json:"failedActions,omitempty"`
}

type Reconciler struct {
	Runner *system.Runner
	Paths  Paths
	Now    func() time.Time
}

func New(runner *system.Runner, paths Paths) *Reconciler {
	return &Reconciler{Runner: runner, Paths: paths, Now: time.Now}
}

// ReadSecrets loads the values the Portal published beside the plan.
func ReadSecrets(path string) (map[string]string, error) {
	secrets := map[string]string{}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return secrets, nil
		}
		return nil, err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, found := strings.Cut(line, "=")
		if found {
			secrets[name] = value
		}
	}
	return secrets, scanner.Err()
}

// Apply converges the running system onto the published plan. It is safe to run
// repeatedly: unchanged files are left alone and Compose reconciles the rest.
func (r *Reconciler) Apply() error {
	plan, err := Load(r.Paths.PlanPath())
	if err != nil {
		return r.fail("", fmt.Errorf("read deployment plan: %w", err))
	}
	secrets, err := ReadSecrets(r.Paths.SecretsPath())
	if err != nil {
		return r.fail(plan.Digest, fmt.Errorf("read published secrets: %w", err))
	}
	r.write(Status{PlanDigest: plan.Digest, State: "applying", Message: "Applying the current plan", UpdatedAt: r.timestamp()})

	rendered, err := Render(plan, secrets, r.Paths.Layout)
	if err != nil {
		return r.fail(plan.Digest, err)
	}
	for _, warning := range plan.Warnings {
		_, _ = fmt.Fprintf(r.Runner.Stdout, "warning: %s\n", warning)
	}
	if err := r.composeUp(); err != nil {
		return r.fail(plan.Digest, fmt.Errorf("docker compose: %w", err))
	}
	// Compose only recreates a container when its definition changes, and a
	// bind-mounted file is not part of that definition. A connector or an app
	// that reads its configuration at startup would otherwise serve the old
	// copy until something unrelated restarted it.
	failed := r.restartStaleServices(plan, rendered.ChangedFiles)
	// Sites served by the appliance's own proxy live outside this Compose
	// project, so a changed site file is reloaded rather than restarted.
	if changedProxySites(rendered.ChangedFiles) {
		if err := r.reloadProxy(); err != nil {
			failed = append(failed, fmt.Sprintf("published sites: %s", err))
		} else {
			_, _ = fmt.Fprintln(r.Runner.Stdout, "Reloaded the published sites.")
		}
	}
	failed = append(failed, r.runProviderActions(plan)...)
	// Applied on every pass rather than only when a blueprint changed: the apply
	// is idempotent, and reconciling unconditionally restores providers that
	// were removed inside Authentik. Failures are reported because sign-in
	// depends on them.
	failed = append(failed, r.applyIdentityBlueprints(rendered.Blueprints)...)
	if rendered.MeshChanged {
		// Who may reach whom depends on this, so a failure is reported.
		if err := r.applyMeshPolicy(); err != nil {
			failed = append(failed, fmt.Sprintf("Kimono VPN: %s", err))
		}
	}

	services := sortedKeys(plan.Compose.Services)
	message := fmt.Sprintf("%d services running", len(services))
	if len(failed) > 0 {
		message = fmt.Sprintf("%s; %d need attention", message, len(failed))
	}
	r.write(Status{PlanDigest: plan.Digest, State: "ready", Message: message, UpdatedAt: r.timestamp(), AppliedServices: services, FailedActions: failed})
	return nil
}

// servicesMountingChangedFiles reports which services bind-mount a generated
// file this pass rewrote, deterministically so a repeat apply is quiet.
func changedProxySites(changed []string) bool {
	for _, file := range changed {
		if strings.HasPrefix(file, ProxySitePrefix) {
			return true
		}
	}
	return false
}

func (r *Reconciler) reloadProxy() error {
	return r.Runner.Run("docker", "exec", "kimono-server-caddy-1",
		"caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")
}

// publishDirectNames points every directly published hostname at the address
// the appliance answers on. One client is built for the whole pass so a zone
// with several apps is not re-authenticated per name.
func (r *Reconciler) publishDirectNames(plan Plan) []string {
	var wanted []ProviderAction
	for _, action := range plan.ProviderActions {
		if action.Mode == "cname" {
			wanted = append(wanted, action)
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	config, err := clouddns.LoadConfig(r.Paths.CloudDNSConfig)
	if err != nil {
		// Without credentials the names cannot be created, and an app published
		// this way is unreachable until they exist. That is worth reporting.
		return []string{fmt.Sprintf("direct publishing: %s", err)}
	}
	client := clouddns.NewClient(config.Token)
	var failed []string
	for _, action := range wanted {
		changed, err := client.UpsertCNAME(config.ZoneID, action.Hostname, action.CNAME)
		if err != nil {
			failed = append(failed, fmt.Sprintf("%s: %s", action.Hostname, err))
			continue
		}
		if changed {
			_, _ = fmt.Fprintf(r.Runner.Stdout, "Pointed %s at %s\n", action.Hostname, action.CNAME)
		}
	}
	return failed
}

func servicesMountingChangedFiles(plan Plan, changed []string) []string {
	if len(changed) == 0 {
		return nil
	}
	stale := map[string]bool{}
	for _, name := range sortedKeys(plan.Compose.Services) {
		for _, mount := range plan.Compose.Services[name].Volumes {
			source, _, found := strings.Cut(mount, ":")
			if !found || !strings.HasPrefix(source, "./") {
				continue
			}
			for _, file := range changed {
				if strings.TrimPrefix(source, "./") == file {
					stale[name] = true
				}
			}
		}
	}
	names := make([]string, 0, len(stale))
	for _, name := range sortedKeys(plan.Compose.Services) {
		if stale[name] {
			names = append(names, name)
		}
	}
	return names
}

func (r *Reconciler) restartStaleServices(plan Plan, changed []string) []string {
	var failed []string
	for _, name := range servicesMountingChangedFiles(plan, changed) {
		if err := r.compose("restart", name); err != nil {
			failed = append(failed, fmt.Sprintf("%s: %s", name, err))
			continue
		}
		_, _ = fmt.Fprintf(r.Runner.Stdout, "Restarted %s to pick up its new configuration\n", name)
	}
	return failed
}

func (r *Reconciler) compose(args ...string) error {
	return r.Runner.Run("docker", append([]string{"compose",
		"--project-name", ProjectName,
		"--project-directory", r.Paths.Layout.ProjectDir,
		"--env-file", r.Paths.Layout.EnvironmentPath(),
		"-f", r.Paths.Layout.ComposePath()}, args...)...)
}

func (r *Reconciler) composeUp() error {
	return r.compose("up", "-d", "--remove-orphans")
}

// runProviderActions creates the DNS records that point each hostname at its
// tunnel. Cloudflare rejects duplicates, which is the expected steady state.
func (r *Reconciler) runProviderActions(plan Plan) []string {
	failed := r.publishDirectNames(plan)
	for _, action := range plan.ProviderActions {
		if action.Mode != "credentials" {
			continue
		}
		directory := filepath.Dir(action.OriginCertificate)
		// The origin certificate stays 0600 and Portal-owned, so this one-shot
		// API call runs as root rather than the image's nonroot user.
		output, err := r.Runner.OutputCombined("docker", "run", "--rm", "--user", "0:0",
			"--volume", directory+":/etc/kimono-origin:ro",
			connectorImage, "tunnel",
			"--origincert", "/etc/kimono-origin/"+filepath.Base(action.OriginCertificate),
			"route", "dns", action.TunnelUUID, action.Hostname)
		if err == nil {
			_, _ = fmt.Fprintf(r.Runner.Stdout, "Routed %s to tunnel %s\n", action.Hostname, action.TunnelID)
			continue
		}
		if recordExists(string(output)) {
			_, _ = fmt.Fprintf(r.Runner.Stdout, "%s already routes to tunnel %s\n", action.Hostname, action.TunnelID)
			continue
		}
		failed = append(failed, fmt.Sprintf("%s: %s", action.Hostname, lastMeaningfulLine(string(output))))
	}
	return failed
}

func recordExists(output string) bool {
	lowered := strings.ToLower(output)
	return strings.Contains(lowered, "already exists") || strings.Contains(lowered, "record with that host")
}

// lastMeaningfulLine reports what cloudflared printed last, which is the
// specific failure rather than the banner it opens with.
func lastMeaningfulLine(value string) string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		if line := strings.TrimSpace(lines[index]); line != "" {
			return line
		}
	}
	return "cloudflared did not report a reason"
}

func firstLine(value string) string {
	line := strings.TrimSpace(value)
	if index := strings.IndexByte(line, '\n'); index >= 0 {
		line = line[:index]
	}
	if line == "" {
		return "cloudflared did not report a reason"
	}
	return line
}

// BlueprintApplyCommand builds the Authentik shell program that registers a
// blueprint file and imports it. Authentik's discovery cycle does not
// instantiate blueprints in the Kimono directory, and `ak apply_blueprint`
// reports success without creating anything, so the importer is driven
// directly. The path is relative to /blueprints, e.g. kimono/kimono-app.yaml.
func BlueprintApplyCommand(path string) string {
	return strings.Join([]string{
		"from hashlib import sha512",
		"from authentik.blueprints.models import BlueprintInstance",
		"from authentik.blueprints.v1.importer import Importer",
		"from authentik.blueprints.v1.tasks import blueprints_find, check_blueprint_v1_file",
		fmt.Sprintf("blueprints = [blueprint for blueprint in blueprints_find() if blueprint.path == %q]", path),
		fmt.Sprintf("assert blueprints, %q", path+" was not discovered"),
		"check_blueprint_v1_file(blueprints[0])",
		"instance = BlueprintInstance.objects.get(path=blueprints[0].path)",
		"content = instance.retrieve()",
		"applied = Importer.from_string(content, instance.context).apply()",
		fmt.Sprintf("assert applied, %q", path+" failed to apply"),
		`instance.status = "successful"`,
		"instance.last_applied_hash = sha512(content.encode()).hexdigest()",
		"instance.save()",
	}, "; ")
}

// applyIdentityBlueprints imports each generated blueprint into Authentik.
func (r *Reconciler) applyIdentityBlueprints(names []string) []string {
	if len(names) == 0 {
		return nil
	}
	worker, err := r.identityWorker()
	if err != nil {
		return []string{fmt.Sprintf("single sign-on: %s", err)}
	}
	directory := strings.TrimPrefix(strings.TrimPrefix(r.blueprintContainerDir(), "/blueprints"), "/")
	var failed []string
	for _, name := range names {
		command := BlueprintApplyCommand(path.Join(directory, name))
		output, err := r.Runner.OutputCombined("docker", "exec", worker, "ak", "shell", "-c", command)
		if err == nil {
			continue
		}
		reason := lastMeaningfulLine(string(output))
		if reason == "" {
			reason = err.Error()
		}
		failed = append(failed, fmt.Sprintf("single sign-on (%s): %s", name, reason))
	}
	return failed
}

// applyMeshPolicy re-renders Headscale's configuration from the policy the
// Portal generated and asks the running server to reload it.
func (r *Reconciler) applyMeshPolicy() error {
	serverDir := filepath.Dir(r.Paths.Layout.MeshDir)
	environment := filepath.Join(filepath.Dir(serverDir), "server.env")
	output, err := r.Runner.OutputCombined("docker", "compose",
		"--project-name", "kimono-server",
		"--project-directory", serverDir,
		"--env-file", environment,
		"-f", filepath.Join(serverDir, "compose.yml"),
		"run", "--rm", "headscale-config")
	if err != nil {
		return fmt.Errorf("render policy: %s", reasonFrom(output, err))
	}
	output, err = r.Runner.OutputCombined("docker", "kill", "--signal", "HUP", "kimono-server-headscale-1")
	if err != nil {
		return fmt.Errorf("reload policy: %s", reasonFrom(output, err))
	}
	return nil
}

func reasonFrom(output []byte, err error) string {
	if reason := lastMeaningfulLine(string(output)); reason != "" {
		return reason
	}
	return err.Error()
}

func (r *Reconciler) blueprintContainerDir() string {
	if r.Paths.BlueprintContainerDir != "" {
		return r.Paths.BlueprintContainerDir
	}
	return DefaultBlueprintContainerDir
}

func (r *Reconciler) identityWorker() (string, error) {
	output, err := r.Runner.Output("docker", "ps", "--filter", "label=com.docker.compose.service=authentik-worker", "--format", "{{.Names}}")
	if err != nil {
		return "", err
	}
	name := firstLine(string(output))
	if name == "" || strings.Contains(name, " ") {
		return "", fmt.Errorf("no Authentik worker container is running")
	}
	return name, nil
}

func (r *Reconciler) timestamp() string { return r.Now().UTC().Format(time.RFC3339) }

func (r *Reconciler) fail(digest string, err error) error {
	r.write(Status{PlanDigest: digest, State: "failed", Message: err.Error(), UpdatedAt: r.timestamp()})
	return err
}

func (r *Reconciler) write(status Status) {
	data, marshalErr := json.MarshalIndent(status, "", "  ")
	if marshalErr != nil {
		return
	}
	if err := os.MkdirAll(r.Paths.DeploymentDir, 0700); err != nil {
		return
	}
	// The Portal runs as a different user and displays this status, so it is
	// world-readable. It reports service names and errors, never secrets.
	temporary := r.Paths.StatusPath() + ".new"
	if err := os.WriteFile(temporary, append(data, '\n'), 0644); err != nil {
		return
	}
	_ = os.Rename(temporary, r.Paths.StatusPath())
}
