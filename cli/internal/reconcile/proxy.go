package reconcile

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// ProxyContainer is the appliance's own proxy, outside this Compose project.
const ProxyContainer = "kimono-server-caddy-1"

// proxyNetworkSuffix ends the name of every network an app shares with the
// proxy alone (the Portal's deployment plan, appEdge). Only these are ever
// joined or left here.
const proxyNetworkSuffix = "-edge"

// containerID is the alias Docker gives every container on its own; it isn't
// copied onto another network.
var containerID = regexp.MustCompile(`^[0-9a-f]{12}$`)

// proxyNetworks are the Docker names of the networks the plan has the proxy
// join: each published app's own, which no other app is on.
func proxyNetworks(plan Plan) []string {
	var names []string
	for _, name := range sortedKeys(plan.Compose.Networks) {
		if plan.Compose.Networks[name].Proxy {
			names = append(names, ProjectName+"_"+name)
		}
	}
	return names
}

// proxyChanges says which app networks the proxy should join and leave, and
// under which names it answers there: the ones it has on kimono-edge, which
// compose.yml gives it (sign-in's and the Portal's own names among them).
func proxyChanges(attached map[string][]string, want []string) (join, leave, aliases []string) {
	for _, alias := range attached[EdgeNetwork] {
		if !containerID.MatchString(alias) && !slices.Contains(aliases, alias) {
			aliases = append(aliases, alias)
		}
	}
	for _, name := range want {
		if _, ok := attached[name]; !ok {
			join = append(join, name)
		}
	}
	for _, name := range sortedKeys(attached) {
		if strings.HasPrefix(name, ProjectName+"_") && strings.HasSuffix(name, proxyNetworkSuffix) && !slices.Contains(want, name) {
			leave = append(leave, name)
		}
	}
	return join, leave, aliases
}

// attachProxy puts the appliance's proxy on each published app's own network,
// and takes it off those no longer in the plan. The proxy is recreated with the
// appliance, which drops what was joined here, so Watch runs this again on its
// own as well as after every apply.
func (r *Reconciler) attachProxy(plan Plan) error {
	want := proxyNetworks(plan)
	output, err := r.Runner.Output("docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", ProxyContainer)
	if err != nil {
		if len(want) == 0 {
			return nil
		}
		return fmt.Errorf("find the appliance's proxy: %w", err)
	}
	if r.Runner.DryRun {
		return nil
	}
	var networks map[string]struct {
		Aliases []string `json:"Aliases"`
	}
	if err := json.Unmarshal(output, &networks); err != nil {
		return fmt.Errorf("read the proxy's networks: %w", err)
	}
	attached := map[string][]string{}
	for name, network := range networks {
		attached[name] = network.Aliases
	}
	join, leave, aliases := proxyChanges(attached, want)
	var failures []string
	for _, name := range join {
		args := []string{"network", "connect"}
		for _, alias := range aliases {
			args = append(args, "--alias", alias)
		}
		if err := r.Runner.Run("docker", append(args, name, ProxyContainer)...); err != nil {
			failures = append(failures, fmt.Sprintf("join %s: %v", name, err))
		}
	}
	for _, name := range leave {
		if err := r.Runner.Run("docker", "network", "disconnect", name, ProxyContainer); err != nil {
			failures = append(failures, fmt.Sprintf("leave %s: %v", name, err))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("the proxy's app networks: %s", strings.Join(failures, "; "))
	}
	return nil
}
