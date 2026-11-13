package server

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

// requiredEnvironment lists every key the appliance definition demands. An
// installation predating a key would otherwise fail to start with an
// interpolation error, so the values are derived or minted during repair.
var requiredEnvironment = []string{
	"ACME_EMAIL", "AUTHENTIK_DOMAIN", "AUTHENTIK_SECRET_KEY", "KIMONO_BASE_DOMAIN",
	"KIMONO_HEADSCALE_OIDC_CLIENT_SECRET", "KIMONO_HEADSCALE_OIDC_ISSUER", "KIMONO_HEADSCALE_OIDC_REDIRECT_URI",
	"KIMONO_PORTAL_DOMAIN", "KIMONO_PORTAL_OIDC_CLIENT_SECRET", "KIMONO_PORTAL_OIDC_REDIRECT_URI",
	"KIMONO_PORTAL_SESSION_SECRET", "MAGIC_DNS_DOMAIN", "MESH_DOMAIN", "PG_PASS",
	"KIMONO_BRAND_ASSET_PATH", "KIMONO_PORTAL_API_TOKEN", "AIOSTREAMS_SECRET_KEY", "NZBDAV_API_KEY", "NZBDAV_WEBDAV_PASSWORD",
	"WATCH_PACKAGER_KEY", "WATCH_PACKAGER_RUNTIME", "BOOKS_KEY", "BOOKS_DB_PASS",
}

// baseDomainOf drops the leftmost label, turning kimono.example.com into
// example.com. A two-label hostname is already the base domain.
func baseDomainOf(hostname string) string {
	labels := strings.Split(strings.Trim(hostname, "."), ".")
	if len(labels) <= 2 {
		return strings.Join(labels, ".")
	}
	return strings.Join(labels[1:], ".")
}

func (m *Manager) derivedEnvironmentValue(key string, values map[string]string) (string, error) {
	switch key {
	case "KIMONO_BRAND_ASSET_PATH":
		// Brand assets are extracted beside the rest of the appliance.
		return filepath.Join(m.serverDir(), "assets"), nil
	case "KIMONO_BASE_DOMAIN":
		for _, source := range []string{"KIMONO_PORTAL_DOMAIN", "AUTHENTIK_DOMAIN", "MESH_DOMAIN"} {
			if values[source] != "" {
				return baseDomainOf(values[source]), nil
			}
		}
	case "MAGIC_DNS_DOMAIN":
		return "kimono.internal", nil
	case "KIMONO_HEADSCALE_OIDC_ISSUER":
		if values["AUTHENTIK_DOMAIN"] != "" {
			return fmt.Sprintf("https://%s/application/o/kimono-headscale/", values["AUTHENTIK_DOMAIN"]), nil
		}
	case "KIMONO_HEADSCALE_OIDC_REDIRECT_URI":
		if values["MESH_DOMAIN"] != "" {
			return fmt.Sprintf("https://%s/oidc/callback", values["MESH_DOMAIN"]), nil
		}
	case "KIMONO_PORTAL_OIDC_REDIRECT_URI":
		if values["KIMONO_PORTAL_DOMAIN"] != "" {
			return fmt.Sprintf("https://%s/api/auth/callback/authentik", values["KIMONO_PORTAL_DOMAIN"]), nil
		}
	case "KIMONO_PORTAL_SESSION_SECRET":
		return system.RandomBase64(48)
	case "AUTHENTIK_SECRET_KEY", "PG_PASS", "KIMONO_HEADSCALE_OIDC_CLIENT_SECRET", "KIMONO_PORTAL_OIDC_CLIENT_SECRET", "KIMONO_PORTAL_API_TOKEN", "AIOSTREAMS_SECRET_KEY", "NZBDAV_API_KEY", "NZBDAV_WEBDAV_PASSWORD", "WATCH_PACKAGER_KEY", "BOOKS_KEY", "BOOKS_DB_PASS":
		return system.RandomHex(32)
	case "WATCH_PACKAGER_RUNTIME":
		// Watch's packager encodes on an NVIDIA GPU only through Docker's nvidia
		// runtime; Intel and AMD GPUs need nothing beyond /dev/dri.
		return m.watchPackagerRuntime(), nil
	}
	return "", fmt.Errorf("%s is required and cannot be derived", key)
}

// watchPackagerRuntime is "nvidia" when Docker has the NVIDIA runtime, else Docker's default.
func (m *Manager) watchPackagerRuntime() string {
	if m.Runner == nil {
		return "runc"
	}
	out, err := m.Runner.Output("docker", "info", "--format", "{{json .Runtimes}}")
	if err == nil && strings.Contains(string(out), `"nvidia"`) {
		return "nvidia"
	}
	return "runc"
}

// ensureServerEnvironment adds any key the current appliance definition needs
// and the installed environment file lacks. Existing values are never changed.
func (m *Manager) ensureServerEnvironment() error {
	values, err := readServerEnvironment(m.envPath())
	if err != nil {
		return fmt.Errorf("Kimono server is not installed; run `sudo kimono server install`: %w", err)
	}
	added := map[string]string{}
	for _, key := range requiredEnvironment {
		if values[key] != "" {
			continue
		}
		value, deriveErr := m.derivedEnvironmentValue(key, values)
		if deriveErr != nil {
			return fmt.Errorf("%w; add it to %s", deriveErr, m.envPath())
		}
		values[key] = value
		added[key] = value
	}
	if len(added) == 0 {
		return nil
	}
	names := make([]string, 0, len(added))
	for key := range added {
		names = append(names, key)
	}
	sort.Strings(names)
	contents, err := os.ReadFile(m.envPath())
	if err != nil {
		return err
	}
	var builder strings.Builder
	builder.Write(contents)
	if len(contents) > 0 && !strings.HasSuffix(string(contents), "\n") {
		builder.WriteString("\n")
	}
	builder.WriteString("\n# Added automatically for a newer appliance definition.\n")
	for _, key := range names {
		fmt.Fprintf(&builder, "%s=%s\n", key, added[key])
	}
	if err := os.WriteFile(m.envPath(), []byte(builder.String()), 0600); err != nil {
		return err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Added missing configuration: %s\n", strings.Join(names, ", "))
	return nil
}

// ensureMeshAPIKey mints the key Kimono VPN uses to read Headscale. It runs
// after the appliance is up because only a running Headscale can issue one.
func (m *Manager) ensureMeshAPIKey() error {
	values, err := readServerEnvironment(m.envPath())
	if err != nil {
		return err
	}
	if values["KIMONO_MESH_API_KEY"] != "" {
		return nil
	}
	// Asking for JSON avoids parsing a human-formatted table, which differs
	// between Headscale releases.
	output, err := m.Runner.OutputCombined("docker", "exec", "kimono-server-headscale-1",
		"headscale", "apikeys", "create", "--expiration", "3650d", "--output", "json")
	if err != nil {
		return fmt.Errorf("create a Kimono VPN API key: %w", err)
	}
	key := meshKeyFrom(string(output))
	if key == "" {
		return fmt.Errorf("Headscale did not return a recognisable Kimono VPN API key (last lines: %s); run `sudo docker exec kimono-server-headscale-1 headscale apikeys create --expiration 3650d` and set KIMONO_MESH_API_KEY in %s", meshKeyShape(string(output)), m.envPath())
	}
	contents, err := os.ReadFile(m.envPath())
	if err != nil {
		return err
	}
	var builder strings.Builder
	builder.Write(contents)
	if len(contents) > 0 && !strings.HasSuffix(string(contents), "\n") {
		builder.WriteString("\n")
	}
	builder.WriteString("\n# Added automatically so the Portal can read the mesh.\nKIMONO_MESH_API_KEY=" + key + "\n")
	if err := os.WriteFile(m.envPath(), []byte(builder.String()), 0600); err != nil {
		return err
	}
	_, _ = fmt.Fprintln(m.Runner.Stdout, "Kimono VPN connected to the mesh.")
	return nil
}

// meshKeyFrom picks the key out of Headscale's output. The surrounding text
// differs by release and by whether --output json is honoured, and the key
// itself is dotted in some versions and not in others, so this matches any
// long unbroken token rather than a particular layout.
var meshKeyPattern = regexp.MustCompile(`[A-Za-z0-9._-]{24,}`)

func meshKeyFrom(output string) string {
	best := ""
	for _, candidate := range meshKeyPattern.FindAllString(output, -1) {
		// A timestamp or a path can be long too; the key is the longest token
		// that is not obviously either.
		if strings.Contains(candidate, "/") || strings.Count(candidate, "-") > 4 {
			continue
		}
		if len(candidate) >= len(best) {
			best = candidate
		}
	}
	return best
}

// meshKeyShape describes output that yielded no key, without printing the
// output itself — it may contain the very secret we failed to recognise.
func meshKeyShape(output string) string {
	var shapes []string
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		shapes = append(shapes, fmt.Sprintf("%d chars", len(trimmed)))
	}
	if len(shapes) == 0 {
		return "no output"
	}
	if len(shapes) > 6 {
		shapes = shapes[len(shapes)-6:]
	}
	return strings.Join(shapes, ", ")
}
