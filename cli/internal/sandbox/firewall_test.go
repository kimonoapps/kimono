package sandbox

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
)

func TestPlanFirewallIPv4(t *testing.T) {
	plan, err := planFirewall(sandboxNet{Subnet4: "172.30.0.0/16", Gateway4: "172.30.0.1"}, 7481)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Chains) != 2 || len(plan.Jumps) != 2 {
		t.Fatalf("want two chains and two jumps for IPv4 only, got %d and %d", len(plan.Chains), len(plan.Jumps))
	}
	forward, input := plan.Chains[0], plan.Chains[1]
	if forward.Name != forwardChain || input.Name != inputChain || forward.Bin != "iptables" {
		t.Fatalf("chains: %+v %+v", forward.Name, input.Name)
	}
	lines := make([]string, len(forward.Rules))
	for i, rule := range forward.Rules {
		lines[i] = strings.Join(rule, " ")
	}
	/* Never the web: nothing a sandbox starts is let through, and nothing RETURNs to Docker's NAT. */
	want := []string{
		"-m conntrack --ctstate RELATED,ESTABLISHED -j RETURN",
		"-j REJECT --reject-with icmp-port-unreachable",
	}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("forward chain:\n%v\nwant\n%v", lines, want)
	}
	in := make([]string, len(input.Rules))
	for i, rule := range input.Rules {
		in[i] = strings.Join(rule, " ")
	}
	want = []string{
		"-m conntrack --ctstate RELATED,ESTABLISHED -j RETURN",
		"-d 172.30.0.1 -p tcp --dport 7481 -j RETURN",
		"-j REJECT --reject-with icmp-port-unreachable",
	}
	if !reflect.DeepEqual(in, want) {
		t.Fatalf("input chain:\n%v\nwant\n%v", in, want)
	}
	if got := plan.Jumps[0]; got.Chain != "DOCKER-USER" || strings.Join(got.Spec, " ") != "-s 172.30.0.0/16 -j KIMONO-SANDBOX" {
		t.Fatalf("forward jump: %+v", got)
	}
	if got := plan.Jumps[1]; got.Chain != "INPUT" || strings.Join(got.Spec, " ") != "-s 172.30.0.0/16 -j KIMONO-SANDBOX-IN" {
		t.Fatalf("input jump: %+v", got)
	}
}

func TestPlanFirewallIPv6Mirrors(t *testing.T) {
	plan, err := planFirewall(sandboxNet{Subnet4: "172.30.0.0/16", Gateway4: "172.30.0.1", Subnet6: "fd00:1::/64", Gateway6: "fd00:1::1"}, 7481)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Chains) != 4 || plan.Chains[2].Bin != "ip6tables" {
		t.Fatalf("want ip6tables chains too, got %+v", plan.Chains)
	}
	for _, rule := range plan.Chains[2].Rules {
		line := strings.Join(rule, " ")
		if strings.Contains(line, "icmp-port-unreachable") {
			t.Error("IPv6 rejects must not name an IPv4 ICMP type")
		}
		if strings.HasSuffix(line, "-j RETURN") && !strings.Contains(line, "conntrack") {
			t.Errorf("the IPv6 forward chain lets something out: %q", line)
		}
	}
}

func TestPlanFirewallRefusesBadInput(t *testing.T) {
	if _, err := planFirewall(sandboxNet{}, 7481); err == nil {
		t.Error("a network without IPv4 must be refused")
	}
	if _, err := planFirewall(sandboxNet{Subnet4: "172.30.0.0/16"}, 7481); err == nil {
		t.Error("a network without a gateway must be refused")
	}
}

// fakeTables is iptables as far as the firewall cares: chains of rules.
type fakeTables struct {
	chains map[string][]string
	calls  []string
}

func newFakeTables() *fakeTables {
	return &fakeTables{chains: map[string][]string{"iptables INPUT": {"-j ACCEPT"}, "iptables FORWARD": {"-j DOCKER-USER"}}}
}

func (f *fakeTables) run(_ context.Context, bin string, args ...string) error {
	f.calls = append(f.calls, bin+" "+strings.Join(args, " "))
	key := func(chain string) string { return bin + " " + chain }
	switch args[0] {
	case "-n":
		if _, ok := f.chains[key(args[2])]; !ok {
			return errors.New("no chain")
		}
	case "-N":
		if _, ok := f.chains[key(args[1])]; ok {
			return errors.New("exists")
		}
		f.chains[key(args[1])] = nil
	case "-F":
		f.chains[key(args[1])] = nil
	case "-A":
		f.chains[key(args[1])] = append(f.chains[key(args[1])], strings.Join(args[2:], " "))
	case "-I":
		f.chains[key(args[1])] = append([]string{strings.Join(args[3:], " ")}, f.chains[key(args[1])]...)
	case "-C":
		for _, rule := range f.chains[key(args[1])] {
			if rule == strings.Join(args[2:], " ") {
				return nil
			}
		}
		return errors.New("no rule")
	}
	return nil
}

func TestFirewallApplyIsIdempotent(t *testing.T) {
	plan, err := planFirewall(sandboxNet{Subnet4: "172.30.0.0/16", Gateway4: "172.30.0.1"}, 7481)
	if err != nil {
		t.Fatal(err)
	}
	tables := newFakeTables()
	ctx := context.Background()
	if plan.inPlace(ctx, tables.run) {
		t.Fatal("nothing applied yet, yet it says in place")
	}
	for i := 0; i < 3; i++ {
		if err := plan.apply(ctx, tables.run); err != nil {
			t.Fatal(err)
		}
	}
	if got := tables.chains["iptables DOCKER-USER"]; len(got) != 1 || got[0] != "-s 172.30.0.0/16 -j KIMONO-SANDBOX" {
		t.Fatalf("DOCKER-USER after three applies: %v", got)
	}
	if got := tables.chains["iptables INPUT"]; len(got) != 2 || got[0] != "-s 172.30.0.0/16 -j KIMONO-SANDBOX-IN" {
		t.Fatalf("INPUT must get the jump first, once: %v", got)
	}
	if got := len(tables.chains["iptables "+forwardChain]); got != len(plan.Chains[0].Rules) {
		t.Fatalf("the chain was rebuilt, not appended to: %d rules", got)
	}
	if !plan.inPlace(ctx, tables.run) {
		t.Fatal("applied, yet not in place")
	}

	// Something takes the INPUT jump away; the recheck restores only that.
	tables.chains["iptables INPUT"] = []string{"-j ACCEPT"}
	tables.calls = nil
	if err := plan.ensureJumps(ctx, tables.run); err != nil {
		t.Fatal(err)
	}
	inserted := 0
	for _, call := range tables.calls {
		if strings.Contains(call, " -I ") {
			inserted++
		}
	}
	if inserted != 1 || tables.chains["iptables INPUT"][0] != "-s 172.30.0.0/16 -j KIMONO-SANDBOX-IN" {
		t.Fatalf("recheck: %d inserts, INPUT %v", inserted, tables.chains["iptables INPUT"])
	}
}

func TestParseNetwork(t *testing.T) {
	n := parseNetwork("172.30.0.0/16|172.30.0.1 fd00:1::/64|fd00:1::1 \n")
	if n.Subnet4 != "172.30.0.0/16" || n.Gateway4 != "172.30.0.1" || n.Subnet6 != "fd00:1::/64" || n.Gateway6 != "fd00:1::1" {
		t.Fatalf("%+v", n)
	}
	if n := parseNetwork("172.30.0.0/16|172.30.0.1 "); n.Subnet6 != "" {
		t.Fatalf("no IPv6 expected: %+v", n)
	}
}
