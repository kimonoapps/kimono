package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
)

/*
 * The sandbox firewall. A sandbox may reach the public internet, and the
 * node's gateway port — the model gateway and Git broker — and nothing else:
 * not the node's other ports, not the LAN, not the mesh, not cloud metadata.
 *
 * Two chains of Kimono's own, entered only by traffic from the sandbox
 * network's subnet:
 *
 *   DOCKER-USER → KIMONO-SANDBOX     traffic a sandbox sends through the node
 *   INPUT       → KIMONO-SANDBOX-IN  traffic a sandbox sends to the node itself
 *
 * Docker leaves DOCKER-USER alone and evaluates it before its own rules, so
 * its NAT keeps working: an allowed packet RETURNs and Docker carries on.
 * Anything addressed to the node — its LAN, public or mesh addresses alike —
 * is local delivery and goes through INPUT, so KIMONO-SANDBOX-IN covers the
 * node's own addresses whatever they are.
 */

const (
	forwardChain = "KIMONO-SANDBOX"
	inputChain   = "KIMONO-SANDBOX-IN"
)

// blockedV4 are the destinations no sandbox reaches through the node.
var blockedV4 = []string{
	"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
	"172.16.0.0/12", "192.168.0.0/16", "224.0.0.0/4", "240.0.0.0/4",
}

// blockedV6 mirrors them when the sandbox network has IPv6.
var blockedV6 = []string{"::1/128", "fc00::/7", "fe80::/10", "fd7a:115c:a1e0::/48", "ff00::/8"}

// sandboxNet is what the firewall needs to know about the sandbox network.
type sandboxNet struct {
	Subnet4, Gateway4 string
	Subnet6, Gateway6 string
}

// firewallPlan is the whole rule set as argv lists, a pure function of the
// network and config so it can be tested without a kernel.
type firewallPlan struct {
	// Chains are rebuilt from scratch: flushed, then filled with Rules.
	Chains []fwChain
	// Jumps are the single rules that send sandbox traffic into the chains;
	// they are checked with -C and inserted only when missing.
	Jumps []fwRule
}

type fwChain struct {
	Bin, Name string
	Rules     [][]string
}

type fwRule struct {
	Bin, Chain string
	Spec       []string
}

func planFirewall(n sandboxNet, gatewayPort int, allow []string) (firewallPlan, error) {
	var plan firewallPlan
	family := func(bin, subnet, gateway string, blocked []string, v6 bool) error {
		if subnet == "" {
			return nil
		}
		if gateway == "" {
			return fmt.Errorf("the sandbox network has no gateway for %s", subnet)
		}
		reject := []string{"-j", "REJECT"}
		if !v6 {
			reject = append(reject, "--reject-with", "icmp-port-unreachable")
		}
		forward := [][]string{{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"}}
		for _, cidr := range allow {
			if isV6(cidr) == v6 {
				forward = append(forward, []string{"-d", cidr, "-j", "RETURN"})
			}
		}
		for _, cidr := range blocked {
			forward = append(forward, append([]string{"-d", cidr}, reject...))
		}
		forward = append(forward, []string{"-j", "RETURN"})
		input := [][]string{
			{"-m", "conntrack", "--ctstate", "RELATED,ESTABLISHED", "-j", "RETURN"},
			{"-d", gateway, "-p", "tcp", "--dport", strconv.Itoa(gatewayPort), "-j", "RETURN"},
			append([]string{}, reject...),
		}
		plan.Chains = append(plan.Chains, fwChain{Bin: bin, Name: forwardChain, Rules: forward}, fwChain{Bin: bin, Name: inputChain, Rules: input})
		plan.Jumps = append(plan.Jumps,
			fwRule{Bin: bin, Chain: "DOCKER-USER", Spec: []string{"-s", subnet, "-j", forwardChain}},
			fwRule{Bin: bin, Chain: "INPUT", Spec: []string{"-s", subnet, "-j", inputChain}},
		)
		return nil
	}
	for _, cidr := range allow {
		if _, _, err := net.ParseCIDR(cidr); err != nil {
			return plan, fmt.Errorf("--allow-private %q isn't a network such as 192.168.1.0/24", cidr)
		}
	}
	if n.Subnet4 == "" {
		return plan, errors.New("the sandbox network has no IPv4 subnet")
	}
	if err := family("iptables", n.Subnet4, n.Gateway4, blockedV4, false); err != nil {
		return plan, err
	}
	if err := family("ip6tables", n.Subnet6, n.Gateway6, blockedV6, true); err != nil {
		return plan, err
	}
	return plan, nil
}

func isV6(cidr string) bool { return strings.Contains(cidr, ":") }

// fwRunner runs iptables; tests replace it.
type fwRunner func(ctx context.Context, bin string, args ...string) error

func execFirewall(ctx context.Context, bin string, args ...string) error {
	out, err := exec.CommandContext(ctx, bin, append([]string{"-w"}, args...)...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %s: %s", bin, strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return nil
}

// apply builds the chains afresh and makes sure each jump is in place,
// inserting it first in its chain only when `-C` says it is missing, so
// running it again changes nothing.
func (p firewallPlan) apply(ctx context.Context, run fwRunner) error {
	for _, chain := range p.Chains {
		if run(ctx, chain.Bin, "-n", "-L", chain.Name) != nil {
			if err := run(ctx, chain.Bin, "-N", chain.Name); err != nil {
				return err
			}
		}
		if err := run(ctx, chain.Bin, "-F", chain.Name); err != nil {
			return err
		}
		for _, rule := range chain.Rules {
			if err := run(ctx, chain.Bin, append([]string{"-A", chain.Name}, rule...)...); err != nil {
				return err
			}
		}
	}
	return p.ensureJumps(ctx, run)
}

// ensureJumps restores a jump that something (a firewalld reload, a Docker
// restart) took away, without touching anything that is already right.
func (p firewallPlan) ensureJumps(ctx context.Context, run fwRunner) error {
	for _, jump := range p.Jumps {
		if jump.Chain == "DOCKER-USER" && run(ctx, jump.Bin, "-n", "-L", "DOCKER-USER") != nil {
			if err := run(ctx, jump.Bin, "-N", "DOCKER-USER"); err != nil {
				return err
			}
		}
		if run(ctx, jump.Bin, append([]string{"-C", jump.Chain}, jump.Spec...)...) == nil {
			continue
		}
		if err := run(ctx, jump.Bin, append([]string{"-I", jump.Chain, "1"}, jump.Spec...)...); err != nil {
			return err
		}
	}
	return nil
}

// inPlace says whether every jump is there.
func (p firewallPlan) inPlace(ctx context.Context, run fwRunner) bool {
	for _, jump := range p.Jumps {
		if run(ctx, jump.Bin, append([]string{"-C", jump.Chain}, jump.Spec...)...) != nil {
			return false
		}
	}
	return len(p.Jumps) > 0
}

// RemoveFirewall takes Kimono's chains and every jump into them away.
func RemoveFirewall(ctx context.Context) {
	for _, bin := range []string{"iptables", "ip6tables"} {
		if _, err := exec.LookPath(bin); err != nil {
			continue
		}
		for _, parent := range []string{"DOCKER-USER", "INPUT"} {
			out, _ := exec.CommandContext(ctx, bin, "-w", "-S", parent).Output()
			for _, line := range strings.Split(string(out), "\n") {
				fields := strings.Fields(line)
				if len(fields) < 2 || fields[0] != "-A" || !strings.Contains(line, " -j "+forwardChain) && !strings.Contains(line, " -j "+inputChain) {
					continue
				}
				_ = exec.CommandContext(ctx, bin, append([]string{"-w", "-D"}, fields[1:]...)...).Run()
			}
		}
		for _, chain := range []string{forwardChain, inputChain} {
			_ = exec.CommandContext(ctx, bin, "-w", "-F", chain).Run()
			_ = exec.CommandContext(ctx, bin, "-w", "-X", chain).Run()
		}
	}
}

// FirewallInPlace reports, for `kimono node sandboxes status`, whether the
// sandbox network's traffic still goes through Kimono's chains.
func FirewallInPlace(ctx context.Context, dockerBin, network string) (bool, string) {
	if dockerDesktop {
		return false, "not applied on this machine (development)"
	}
	if _, err := exec.LookPath("iptables"); err != nil {
		return false, "iptables isn't installed"
	}
	n, err := (docker{bin: dockerBin}).inspectNetwork(ctx, network)
	if err != nil || n.Subnet4 == "" {
		return false, "the sandbox network doesn't exist yet"
	}
	plan, err := planFirewall(n, 0, nil)
	if err != nil {
		return false, err.Error()
	}
	if !plan.inPlace(ctx, execFirewall) {
		return false, "missing: sandboxes can reach private networks"
	}
	return true, "in place: sandboxes reach the internet and the gateway only"
}

// guardNetwork puts the firewall in place, or explains why the node refuses
// to run sandboxes without it.
func (s *Server) guardNetwork(ctx context.Context, n sandboxNet, gatewayPort int) error {
	if dockerDesktop {
		s.cfg.Logf("firewall not applied on macOS (Docker Desktop): sandboxes can reach this machine's networks; development only")
		return nil
	}
	if s.cfg.AllowOpenNetwork {
		s.cfg.Logf("firewall off (--allow-open-network): sandboxes can reach private networks; development only")
		return nil
	}
	if _, err := exec.LookPath("iptables"); err != nil {
		return errors.New("sandboxes need iptables to keep them off this node's private networks; install it (apt-get install iptables), or pass --allow-open-network for development")
	}
	plan, err := planFirewall(n, gatewayPort, s.cfg.AllowPrivate)
	if err != nil {
		return err
	}
	run := s.fwRun
	if run == nil {
		run = execFirewall
	}
	if err := plan.apply(ctx, run); err != nil {
		return fmt.Errorf("put the sandbox firewall in place: %w", err)
	}
	s.firewall = &plan
	what := "internet and gateway only"
	if len(s.cfg.AllowPrivate) > 0 {
		what += ", plus " + strings.Join(s.cfg.AllowPrivate, ", ")
	}
	s.cfg.Logf("firewall in place for %s (%s)", strings.TrimSpace(n.Subnet4+" "+n.Subnet6), what)
	return nil
}

// recheckFirewall restores a jump something removed since startup. It is
// cheap — one `-C` per jump — so it runs before any sandbox starts.
func (s *Server) recheckFirewall(ctx context.Context) error {
	if s.firewall == nil {
		return nil
	}
	run := s.fwRun
	if run == nil {
		run = execFirewall
	}
	return s.firewall.ensureJumps(ctx, run)
}
