// Package reconcile turns the Portal's desired-state deployment plan into a
// running Docker Compose project. It is executed by the reconciler sidecar so
// that administrators never have to run a command to deploy an app.
package reconcile

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"regexp"
	"sort"
	"strings"
)

const (
	PlanAPIVersion  = "deployment.kimono.dev/v1alpha1"
	ProjectName     = "kimono-apps"
	BlueprintPrefix = "authentik/"
	// MeshPrefix marks the generated Headscale access policy.
	MeshPrefix = "mesh/"
	// AppPrefix marks generated files an app reads directly. They carry the same
	// client secrets blueprints do, so they are written with the same care.
	AppPrefix = "apps/"
	// ProxySitePrefix marks a site file the appliance's own proxy serves.
	ProxySitePrefix = "generated/caddy-"
	// EdgeNetwork joins published apps to the appliance's proxy and connectors.
	// The appliance creates it; this project attaches to it by name.
	EdgeNetwork = "kimono-edge"
)

type Service struct {
	Image       string            `json:"image"`
	Restart     string            `json:"restart"`
	Environment map[string]string `json:"environment,omitempty"`
	DependsOn   []string          `json:"depends_on,omitempty"`
	Volumes     []string          `json:"volumes,omitempty"`
	Networks    []string          `json:"networks"`
	Command     []string          `json:"command,omitempty"`
	SecurityOpt []string          `json:"security_opt"`
}

type Network struct {
	Internal bool `json:"internal,omitempty"`
}

type ProviderAction struct {
	Provider          string `json:"provider"`
	TunnelID          string `json:"tunnelId"`
	Mode              string `json:"mode"`
	TunnelUUID        string `json:"tunnelUuid"`
	OriginCertificate string `json:"originCertificate"`
	Hostname          string `json:"hostname"`
	Path              string `json:"path"`
	Target            string `json:"target"`
	// CNAME is the name a directly published hostname points at. It is the
	// address the appliance already answers on, kept current by Dynamic DNS.
	CNAME string `json:"cname"`
}

type Plan struct {
	APIVersion string `json:"apiVersion"`
	Runtime    struct {
		ID     string `json:"id"`
		Engine string `json:"engine"`
	} `json:"runtime"`
	Compose struct {
		Name     string              `json:"name"`
		Services map[string]Service  `json:"services"`
		Volumes  map[string]struct{} `json:"volumes"`
		Networks map[string]Network  `json:"networks"`
	} `json:"compose"`
	Files           map[string]string `json:"files"`
	ProviderActions []ProviderAction  `json:"providerActions"`
	Secrets         []string          `json:"secrets"`
	Warnings        []string          `json:"warnings"`
	Digest          string            `json:"digest"`
}

var (
	namePattern        = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,62}$`)
	imagePattern       = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/-]*(?::[a-zA-Z0-9._-]+)?(?:@sha256:[a-f0-9]{64})?$`)
	environmentPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	hostnamePattern    = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$`)
	uuidPattern        = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$`)
	secretPattern      = regexp.MustCompile(`\$\{(KIMONO_SECRET_[A-Z0-9_]+)\}`)
)

func Load(path string) (Plan, error) {
	var plan Plan
	data, err := os.ReadFile(path)
	if err != nil {
		return plan, err
	}
	if err := json.Unmarshal(data, &plan); err != nil {
		return plan, fmt.Errorf("deployment plan is not valid JSON: %w", err)
	}
	return plan, plan.Validate()
}

// Validate refuses any plan that would name unexpected paths, images, or
// container settings. The Portal is trusted to describe apps, not to hand the
// reconciler arbitrary Docker instructions.
func (p Plan) Validate() error {
	if p.APIVersion != PlanAPIVersion {
		return fmt.Errorf("unsupported plan apiVersion %q", p.APIVersion)
	}
	if p.Runtime.Engine != "docker-compose" {
		return fmt.Errorf("unsupported runtime engine %q", p.Runtime.Engine)
	}
	if p.Compose.Name != ProjectName {
		return fmt.Errorf("plan targets project %q instead of %q", p.Compose.Name, ProjectName)
	}
	if len(p.Compose.Services) == 0 && len(p.Files) == 0 {
		return nil
	}
	for name, service := range p.Compose.Services {
		if !namePattern.MatchString(name) {
			return fmt.Errorf("invalid service name %q", name)
		}
		if !imagePattern.MatchString(service.Image) {
			return fmt.Errorf("%s: invalid image reference %q", name, service.Image)
		}
		for key := range service.Environment {
			if !environmentPattern.MatchString(key) {
				return fmt.Errorf("%s: invalid environment key %q", name, key)
			}
		}
		for _, network := range service.Networks {
			if _, ok := p.Compose.Networks[network]; !ok {
				return fmt.Errorf("%s: joins undeclared network %q", name, network)
			}
		}
		for _, dependency := range service.DependsOn {
			if _, ok := p.Compose.Services[dependency]; !ok {
				return fmt.Errorf("%s: depends on unknown service %q", name, dependency)
			}
		}
		for _, mount := range service.Volumes {
			if err := validateMount(name, mount, p.Compose.Volumes); err != nil {
				return err
			}
		}
	}
	for name := range p.Compose.Volumes {
		if !namePattern.MatchString(name) {
			return fmt.Errorf("invalid volume name %q", name)
		}
	}
	for name := range p.Compose.Networks {
		if !namePattern.MatchString(name) {
			return fmt.Errorf("invalid network name %q", name)
		}
	}
	for file := range p.Files {
		if err := validateFilePath(file); err != nil {
			return err
		}
	}
	for _, action := range p.ProviderActions {
		if action.Provider != "cloudflare" && action.Provider != "direct" {
			return fmt.Errorf("unsupported provider %q", action.Provider)
		}
		if !hostnamePattern.MatchString(action.Hostname) {
			return fmt.Errorf("invalid route hostname %q", action.Hostname)
		}
		if action.Mode == "cname" {
			// A record pointing at itself would be a resolution loop.
			if !hostnamePattern.MatchString(action.CNAME) {
				return fmt.Errorf("%s: invalid CNAME target %q", action.Hostname, action.CNAME)
			}
			if action.CNAME == action.Hostname {
				return fmt.Errorf("%s: cannot point at itself", action.Hostname)
			}
		}
		if action.Mode == "credentials" {
			if !uuidPattern.MatchString(action.TunnelUUID) {
				return fmt.Errorf("%s: invalid tunnel identifier %q", action.Hostname, action.TunnelUUID)
			}
			if !strings.HasPrefix(action.OriginCertificate, "/") || strings.Contains(action.OriginCertificate, "..") {
				return fmt.Errorf("%s: origin certificate must be an absolute path", action.Hostname)
			}
		}
	}
	return nil
}

func validateMount(service, mount string, volumes map[string]struct{}) error {
	parts := strings.Split(mount, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return fmt.Errorf("%s: invalid volume %q", service, mount)
	}
	if len(parts) == 3 && parts[2] != "ro" && parts[2] != "rw" {
		return fmt.Errorf("%s: unsupported mount mode in %q", service, mount)
	}
	if !strings.HasPrefix(parts[1], "/") {
		return fmt.Errorf("%s: container path must be absolute in %q", service, mount)
	}
	source := parts[0]
	if strings.Contains(source, "..") {
		return fmt.Errorf("%s: volume source may not traverse directories in %q", service, mount)
	}
	if strings.HasPrefix(source, "/") || strings.HasPrefix(source, "./") {
		return nil
	}
	if _, ok := volumes[source]; !ok {
		return fmt.Errorf("%s: mounts undeclared volume %q", service, source)
	}
	return nil
}

func validateFilePath(file string) error {
	if file == "" || strings.HasPrefix(file, "/") || strings.Contains(file, "..") || path.Clean(file) != file {
		return fmt.Errorf("invalid generated file path %q", file)
	}
	return nil
}

// ExpandSecrets substitutes the values the Portal stored beside the plan.
func ExpandSecrets(contents string, secrets map[string]string) (string, error) {
	var missing []string
	expanded := secretPattern.ReplaceAllStringFunc(contents, func(match string) string {
		name := secretPattern.FindStringSubmatch(match)[1]
		value, ok := secrets[name]
		if !ok {
			missing = append(missing, name)
			return match
		}
		return value
	})
	if len(missing) > 0 {
		sort.Strings(missing)
		return "", fmt.Errorf("missing secret values: %s", strings.Join(missing, ", "))
	}
	return expanded, nil
}
