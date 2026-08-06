package system

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
)

type Runner struct {
	DryRun bool
	Stdin  io.Reader
	Stdout io.Writer
	Stderr io.Writer
}

func NewRunner() *Runner {
	return &Runner{
		DryRun: os.Getenv("KIMONO_DRY_RUN") == "1",
		Stdin:  os.Stdin,
		Stdout: os.Stdout,
		Stderr: os.Stderr,
	}
}

func (r *Runner) Run(name string, args ...string) error {
	if r.DryRun {
		_, _ = fmt.Fprintf(r.Stdout, "+ %s\n", shellLine(name, args))
		return nil
	}
	cmd := exec.Command(name, args...)
	cmd.Stdin = r.Stdin
	cmd.Stdout = r.Stdout
	cmd.Stderr = r.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s: %w", shellLine(name, args), err)
	}
	return nil
}

// RunSensitive executes a command without rendering its arguments in dry-run
// output or errors. Use it for short-lived credentials such as mesh enrollment
// keys, which must never be copied into logs.
func (r *Runner) RunSensitive(name string, args ...string) error {
	if r.DryRun {
		_, _ = fmt.Fprintf(r.Stdout, "+ %s <sensitive arguments omitted>\n", name)
		return nil
	}
	cmd := exec.Command(name, args...)
	cmd.Stdin = r.Stdin
	cmd.Stdout = r.Stdout
	cmd.Stderr = r.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%s failed: %w", name, err)
	}
	return nil
}

func (r *Runner) Output(name string, args ...string) ([]byte, error) {
	if r.DryRun {
		_, _ = fmt.Fprintf(r.Stdout, "+ %s\n", shellLine(name, args))
		return nil, nil
	}
	cmd := exec.Command(name, args...)
	cmd.Stdin = r.Stdin
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = r.Stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("%s: %w", shellLine(name, args), err)
	}
	return stdout.Bytes(), nil
}

func (r *Runner) Exists(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func shellLine(name string, args []string) string {
	parts := append([]string{name}, args...)
	for i, part := range parts {
		if strings.ContainsAny(part, " \t\n\"'") {
			parts[i] = fmt.Sprintf("%q", part)
		}
	}
	return strings.Join(parts, " ")
}
