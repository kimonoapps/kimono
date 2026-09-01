// Package update replaces the installed kimono binary and then brings the
// appliance up to date, so a running server is one command behind a release.
package update

import (
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/system"
)

const defaultRepository = "kimonoapps/kimono"

// Manager performs a self-update followed by an appliance update.
type Manager struct {
	Runner *system.Runner
	// Client is exposed so tests can serve a release without network access.
	Client *http.Client
}

func New(runner *system.Runner) *Manager {
	return &Manager{Runner: runner, Client: &http.Client{Timeout: 5 * time.Minute}}
}

func downloadBase() string {
	if base := os.Getenv("KIMONO_DOWNLOAD_BASE"); base != "" {
		return strings.TrimSuffix(base, "/")
	}
	repository := os.Getenv("KIMONO_REPOSITORY")
	if repository == "" {
		repository = defaultRepository
	}
	return fmt.Sprintf("https://github.com/%s/releases/latest/download", repository)
}

// assetName matches the names the release workflow and installer already use.
func assetName() (string, error) {
	switch runtime.GOARCH {
	case "amd64", "arm64":
		return "kimono_linux_" + runtime.GOARCH, nil
	default:
		return "", fmt.Errorf("unsupported CPU architecture %s", runtime.GOARCH)
	}
}

// Run updates the binary in place and then the appliance. The appliance step
// runs through the freshly written binary, so embedded files and the update
// logic always come from the same release.
func (m *Manager) Run(args []string) error {
	flags := flag.NewFlagSet("update", flag.ContinueOnError)
	skipSelf := flags.Bool("no-self", false, "skip replacing the kimono binary and only update the appliance")
	skipServer := flags.Bool("no-server", false, "replace the kimono binary without touching the appliance")
	if err := flags.Parse(args); err != nil {
		return err
	}

	if err := system.RequireRoot(); err != nil {
		return err
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return err
	}

	if !*skipSelf {
		replaced, err := m.replaceBinary(executable)
		if err != nil {
			return err
		}
		if !replaced {
			_, _ = fmt.Fprintln(m.Runner.Stdout, "kimono is already the latest release.")
		}
	}

	if *skipServer {
		return nil
	}
	// The appliance's environment file, which is what every other server
	// command opens. Asking system.Home() keeps a relocated KIMONO_HOME
	// working; hardcoding the path once made this gate refuse every install.
	if _, err := os.Stat(applianceEnvironmentPath()); err != nil {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "No appliance is installed here; the binary is up to date.")
		return nil
	}
	return m.Runner.Run(executable, "server", "update")
}

// applianceEnvironmentPath mirrors the server manager's envPath, which is the
// only file that proves an appliance was configured on this machine.
func applianceEnvironmentPath() string {
	return filepath.Join(system.Home(), "server.env")
}

// replaceBinary downloads the published binary, verifies it against the
// release checksums, and swaps it in atomically. It reports whether anything
// changed so an already-current install stays quiet.
func (m *Manager) replaceBinary(executable string) (bool, error) {
	asset, err := assetName()
	if err != nil {
		return false, err
	}
	base := downloadBase()

	binary, err := m.fetch(base + "/" + asset)
	if err != nil {
		return false, fmt.Errorf("download %s: %w", asset, err)
	}
	sums, err := m.fetch(base + "/SHA256SUMS")
	if err != nil {
		return false, fmt.Errorf("download release checksums: %w", err)
	}
	expected := checksumFor(string(sums), asset)
	if expected == "" {
		return false, fmt.Errorf("the release checksums do not list %s", asset)
	}
	actual := sha256.Sum256(binary)
	if hex.EncodeToString(actual[:]) != expected {
		return false, fmt.Errorf("checksum verification failed for %s", asset)
	}

	current, err := os.ReadFile(executable)
	if err == nil {
		running := sha256.Sum256(current)
		if running == actual {
			return false, nil
		}
	}

	// Written beside the target so the rename stays on one filesystem.
	temporary := executable + ".update"
	if err := os.WriteFile(temporary, binary, 0755); err != nil {
		return false, err
	}
	if err := os.Rename(temporary, executable); err != nil {
		_ = os.Remove(temporary)
		return false, err
	}
	_, _ = fmt.Fprintf(m.Runner.Stdout, "Updated %s to the latest release.\n", executable)
	return true, nil
}

func (m *Manager) fetch(url string) ([]byte, error) {
	response, err := m.Client.Get(url)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s returned %s", url, response.Status)
	}
	return io.ReadAll(response.Body)
}

func checksumFor(sums string, asset string) string {
	for _, line := range strings.Split(sums, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && fields[1] == asset {
			return fields[0]
		}
	}
	return ""
}
