package sandbox

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
)

// docker drives the Docker CLI. Kimono already depends on it on every node,
// and it keeps the binary free of a Docker SDK.
type docker struct{ bin string }

// execError carries a command's exit status and what it said on stderr.
type execError struct {
	code   int
	stderr string
}

func (e *execError) Error() string {
	if e.stderr != "" {
		return e.stderr
	}
	return fmt.Sprintf("exit status %d", e.code)
}

func exitCode(err error) int {
	var failure *execError
	if errors.As(err, &failure) {
		return failure.code
	}
	return -1
}

func (d docker) run(ctx context.Context, stdin io.Reader, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, d.bin, args...)
	cmd.Stdin = stdin
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return stdout.Bytes(), &execError{code: exit.ExitCode(), stderr: strings.TrimSpace(stderr.String())}
		}
		return stdout.Bytes(), err
	}
	return stdout.Bytes(), nil
}

func containerName(id string) string { return "kimono-sbx-" + id }

// containerState is "running", "paused", "exited", "created", … or "" when
// there is no container.
func (d docker) containerState(ctx context.Context, id string) (string, error) {
	out, err := d.run(ctx, nil, "inspect", "-f", "{{.State.Status}}", containerName(id))
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such") {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (d docker) hasRuntime(ctx context.Context, name string) bool {
	out, err := d.run(ctx, nil, "info", "--format", "{{json .Runtimes}}")
	return err == nil && bytes.Contains(out, []byte(`"`+name+`"`))
}

// ensureNetwork makes the sandboxes' bridge, with containers unable to reach
// one another, and returns its gateway address.
func (d docker) ensureNetwork(ctx context.Context, name string) (string, error) {
	inspect := func() ([]byte, error) {
		return d.run(ctx, nil, "network", "inspect", "-f", "{{range .IPAM.Config}}{{.Gateway}} {{end}}", name)
	}
	out, err := inspect()
	if err != nil {
		if _, err := d.run(ctx, nil, "network", "create", "--driver", "bridge", "--label", "kimono.sandbox=network",
			"-o", "com.docker.network.bridge.enable_icc=false", name); err != nil {
			return "", fmt.Errorf("create the sandbox network: %w", err)
		}
		if out, err = inspect(); err != nil {
			return "", err
		}
	}
	for _, gateway := range strings.Fields(string(out)) {
		if !strings.Contains(gateway, ":") {
			return gateway, nil
		}
	}
	return "", fmt.Errorf("the %s network has no IPv4 gateway", name)
}

// sandboxes lists the containers Kimono made, by workspace id, with their state.
func (d docker) sandboxes(ctx context.Context) (map[string]string, error) {
	out, err := d.run(ctx, nil, "ps", "-a", "--filter", "label=kimono.sandbox", "--format", `{{.Label "kimono.sandbox"}} {{.State}}`)
	if err != nil {
		return nil, err
	}
	found := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && validID(fields[0]) {
			found[fields[0]] = fields[1]
		}
	}
	return found, nil
}
