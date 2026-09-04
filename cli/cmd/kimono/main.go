package main

import (
	"fmt"
	"os"

	"github.com/kimonoapps/kimono/cli/internal/node"
	"github.com/kimonoapps/kimono/cli/internal/server"
	"github.com/kimonoapps/kimono/cli/internal/system"
	"github.com/kimonoapps/kimono/cli/internal/update"
)

var version = "0.1.0-dev"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "kimono: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		printHelp()
		return nil
	}
	runner := system.NewRunner()
	serverManager := server.New(runner)
	nodeManager := node.New(runner)

	switch args[0] {
	case "server":
		return serverManager.Execute(args[1:])
	case "node":
		return nodeManager.Execute(args[1:])
	case "install":
		return nodeManager.Execute(append([]string{"install"}, args[1:]...))
	case "update":
		return update.New(runner).Run(args[1:])
	case "expose", "unexpose", "list", "inspect", "logs", "status", "doctor", "login", "logout":
		return nodeManager.Execute(args)
	case "version", "--version", "-v":
		fmt.Printf("kimono %s\n", version)
		return nil
	case "help", "--help", "-h":
		printHelp()
		return nil
	default:
		return fmt.Errorf("unknown command %q; run `kimono help`", args[0])
	}
}

func printHelp() {
	fmt.Print(`Kimono provisions a private application platform and connects clients.

Usage:
  kimono update             Update Kimono itself, then the appliance
  kimono server <command>   Manage the main Kimono control-plane VM
  kimono node <command>     Manage a client connected to the Kimono mesh

Server commands:
  install   Configure and start Authentik, Headscale, DERP, and HTTPS
  start     Start the Kimono appliance
  stop      Stop the Kimono appliance
  status    Show appliance service health
  apply     Reconcile the Portal's deployment plan (normally automatic)
  doctor    Verify public DNS and show appliance health
  repair    Restore embedded files and container-readable permissions
  enrollment create  Mint a single-use key for a client or admin device
  cloudflare-ddns  Keep server DNS pointed at a dynamic public IP
  logs      Follow appliance logs
  update    Pull pinned service updates and recreate the appliance
  backup    Stop briefly and create a complete volume backup

Node commands:
  install   Install Tailscale and join the Kimono private mesh
  login     Re-enroll this client with a new single-use key
  logout    Remove this machine's current mesh login
  hosting tls  Obtain and renew HTTPS certificates for a manual Wings node
  expose    Optionally publish a local container or HTTP port
  unexpose  Stop one optional local exposure
  list      List optional local exposures
  inspect   Show one optional local exposure
  logs      Follow the optional exposure tunnel logs
  status    Show client and mesh status
  doctor    Diagnose client configuration and mesh connectivity

Common node commands can omit "node":
  kimono expose --domain apps.example.com notes:3000
  kimono list
  kimono doctor

Environment:
  KIMONO_HOME=/var/lib/kimono   Override the state directory
  KIMONO_DRY_RUN=1              Print external commands without running them
`)
}
