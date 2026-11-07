package reconcile

import (
	"reflect"
	"testing"
)

// Each published app has a network of its own with the proxy: the proxy joins
// the ones the plan names, under its kimono-edge names, and leaves the rest.
func TestProxyJoinsEachAppsOwnNetworkOnly(t *testing.T) {
	plan := Plan{}
	plan.Compose.Networks = map[string]Network{
		"photos-edge":    {Internal: true, Proxy: true},
		"photos-private": {Internal: true},
		"wiki-edge":      {Internal: true, Proxy: true},
		TunnelNetwork:    {},
	}
	want := proxyNetworks(plan)
	if !reflect.DeepEqual(want, []string{"kimono-apps_photos-edge", "kimono-apps_wiki-edge"}) {
		t.Fatalf("proxy networks = %v", want)
	}
	attached := map[string][]string{
		EdgeNetwork:               {"caddy", "auth.example.com", "kimono.example.com", "0123456789ab"},
		"kimono-server_default":   {"caddy"},
		"kimono-apps_photos-edge": {"caddy"},
		"kimono-apps_old-edge":    {"caddy"},
		"kimono-apps_x-private":   {},
	}
	join, leave, aliases := proxyChanges(attached, want)
	if !reflect.DeepEqual(join, []string{"kimono-apps_wiki-edge"}) {
		t.Fatalf("join = %v", join)
	}
	if !reflect.DeepEqual(leave, []string{"kimono-apps_old-edge"}) {
		t.Fatalf("leave = %v", leave)
	}
	if !reflect.DeepEqual(aliases, []string{"caddy", "auth.example.com", "kimono.example.com"}) {
		t.Fatalf("aliases = %v", aliases)
	}
}
