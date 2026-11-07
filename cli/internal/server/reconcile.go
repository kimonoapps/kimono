package server

import (
	"context"
	"errors"
	"flag"
	"github.com/kimonoapps/kimono/cli/internal/backup"
	"os"
	"path/filepath"
	"time"

	"github.com/kimonoapps/kimono/cli/internal/reconcile"
	"github.com/kimonoapps/kimono/cli/internal/services"
)

const (
	defaultPortalState = "/var/lib/kimono-portal"
	watchInterval      = 2 * time.Second
	retryInterval      = 30 * time.Second
)

func (m *Manager) reconcilePaths() reconcile.Paths {
	state := os.Getenv("KIMONO_PORTAL_STATE_DIR")
	if state == "" {
		state = defaultPortalState
	}
	blueprints := os.Getenv("KIMONO_BLUEPRINT_DIR")
	if blueprints == "" {
		blueprints = filepath.Join(m.serverDir(), "authentik", "blueprints")
	}
	return reconcile.Paths{
		DeploymentDir:         filepath.Join(state, "deployment"),
		CloudDNSConfig:        m.cloudflareConfigPath(),
		BlueprintContainerDir: os.Getenv("KIMONO_BLUEPRINT_CONTAINER_DIR"),
		Layout: reconcile.Layout{
			ProjectDir:   filepath.Join(m.Home, "apps"),
			BlueprintDir: blueprints,
			MeshDir:      filepath.Join(m.serverDir(), "headscale"),
		},
	}
}

// apply runs the reconciler. The sidecar uses --watch; the subcommand exists as
// a manual escape hatch and is not part of the normal administration path.
func (m *Manager) apply(args []string) error {
	flags := flag.NewFlagSet("server apply", flag.ContinueOnError)
	watch := flags.Bool("watch", false, "keep running and apply the plan whenever the Portal changes it")
	if err := flags.Parse(args); err != nil {
		return err
	}
	reconciler := reconcile.New(m.Runner, m.reconcilePaths())
	worker := backup.New(m.Home, filepath.Dir(m.reconcilePaths().DeploymentDir))
	if !m.Runner.DryRun {
		reconciler.Idle = worker.Tick
	}
	if *watch {
		/* Kimono's own services are kept running beside the deployment loop, and
		   restarted when an administrator asks from the Portal. */
		if !m.Runner.DryRun {
			go services.New(filepath.Dir(m.reconcilePaths().DeploymentDir), services.CLI).Run(context.Background(), watchInterval)
		}
		err := reconciler.Watch(context.Background(), watchInterval, retryInterval)
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	return reconciler.Apply()
}
