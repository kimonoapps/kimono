package main

import (
	"fmt"
	"os"

	"github.com/kimonoapps/kimono/cli/internal/node"
	"github.com/kimonoapps/kimono/cli/internal/server"
	"github.com/kimonoapps/kimono/cli/internal/system"
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
	case "expose", "unexpose", "list", "inspect", "status", "doctor", "logs", "login", "logout":
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
	fmt.Print(`Kimono provisions a private application platform on your own VMs.

Usage:
  kimono server <command>   Manage the main Kimono control-plane VM
  kimono node <command>     Manage an application VM

Server commands:
  install   Configure and start Authentik, Headscale, DERP, and HTTPS
  start     Start the Kimono appliance
  stop      Stop the Kimono appliance
  status    Show appliance service health
  doctor    Verify public DNS and show appliance health
  repair    Restore embedded files and container-readable permissions
  enrollment create  Mint a single-use key for an isolated node or admin device
  cloudflare-ddns  Keep server DNS pointed at a dynamic public IP
  logs      Follow appliance logs
  update    Pull pinned service updates and recreate the appliance
  backup    Stop briefly and create a complete volume backup

Node commands:
  install   Install dependencies, join the mesh, and create a Cloudflare tunnel
  login     Re-enroll this service VM with a new single-use key
  logout    Remove this machine's current mesh login
  expose    Publish a container or host HTTP port
  unexpose  Stop routing an application
  list      List exposed applications
  inspect   Show one exposure
  status    Show mesh and tunnel status
  doctor    Diagnose node dependencies and connectivity
  logs      Follow Cloudflare Tunnel logs

Common node commands can omit "node":
  kimono expose notes:3000
  kimono list
  kimono doctor

Environment:
  KIMONO_HOME=/var/lib/kimono   Override the state directory
  KIMONO_DRY_RUN=1              Print external commands without running them
`)
}
