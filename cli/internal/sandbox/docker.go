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

// stream is run with stdout written as it comes rather than held: for files
// too big to keep in memory. stderr is still kept, for the error.
func (d docker) stream(ctx context.Context, stdin io.Reader, stdout io.Writer, args ...string) error {
	cmd := exec.CommandContext(ctx, d.bin, args...)
	cmd.Stdin = stdin
	cmd.Stdout = stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return &execError{code: exit.ExitCode(), stderr: strings.TrimSpace(stderr.String())}
		}
		return err
	}
	return nil
}

func containerName(id string) string { return "kimono-sbx-" + id }

// containerState is "running", "paused", "exited", "created", … or "" when
// there is no container.
func (d docker) containerState(ctx context.Context, id string) (string, error) {
	out, err := d.run(ctx, nil, "container", "inspect", "-f", "{{.State.Status}}", containerName(id))
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
// one another and no IPv6 (so the firewall has one family to keep), and
// returns its addresses.
func (d docker) ensureNetwork(ctx context.Context, name string) (sandboxNet, error) {
	n, err := d.inspectNetwork(ctx, name)
	if err != nil {
		if _, err := d.run(ctx, nil, "network", "create", "--driver", "bridge", "--label", "kimono.sandbox=network",
			"--ipv6=false", "-o", "com.docker.network.bridge.enable_icc=false", name); err != nil {
			return sandboxNet{}, fmt.Errorf("create the sandbox network: %w", err)
		}
		if n, err = d.inspectNetwork(ctx, name); err != nil {
			return sandboxNet{}, err
		}
	}
	if n.Gateway4 == "" {
		return n, fmt.Errorf("the %s network has no IPv4 gateway", name)
	}
	return n, nil
}

// inspectNetwork reads a network's subnets and gateways, IPv4 and IPv6.
func (d docker) inspectNetwork(ctx context.Context, name string) (sandboxNet, error) {
	out, err := d.run(ctx, nil, "network", "inspect", "-f", "{{range .IPAM.Config}}{{.Subnet}}|{{.Gateway}} {{end}}", name)
	if err != nil {
		return sandboxNet{}, err
	}
	return parseNetwork(string(out)), nil
}

func parseNetwork(out string) sandboxNet {
	var n sandboxNet
	for _, field := range strings.Fields(out) {
		subnet, gateway, _ := strings.Cut(field, "|")
		if strings.Contains(subnet, ":") {
			n.Subnet6, n.Gateway6 = subnet, gateway
		} else if subnet != "" {
			n.Subnet4, n.Gateway4 = subnet, gateway
		}
	}
	return n
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
