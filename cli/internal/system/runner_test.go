package system

import (
	"bytes"
	"strings"
	"testing"
)

func TestRunSensitiveRedactsDryRunArguments(t *testing.T) {
	var output bytes.Buffer
	runner := &Runner{DryRun: true, Stdout: &output}
	secret := "hskey-auth-do-not-print-this"
	if err := runner.RunSensitive("tailscale", "up", "--auth-key", secret); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(output.String(), secret) {
		t.Fatalf("sensitive argument leaked in output: %q", output.String())
	}
}
