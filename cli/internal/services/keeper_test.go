package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeDocker struct {
	states map[string]string // service -> "status/health"
	calls  []string
}

func (f *fakeDocker) run(_ context.Context, args ...string) ([]byte, error) {
	f.calls = append(f.calls, strings.Join(args, " "))
	if args[0] != "inspect" {
		id := strings.TrimSuffix(strings.TrimPrefix(args[1], Project+"-"), "-1")
		f.states[id] = "running/healthy"
		return nil, nil
	}
	id := strings.TrimSuffix(strings.TrimPrefix(args[1], Project+"-"), "-1")
	value, ok := f.states[id]
	if !ok {
		value = "running/"
	}
	status, health, _ := strings.Cut(value, "/")
	item := map[string]any{"State": map[string]any{"Status": status, "StartedAt": "2026-11-07T00:00:00Z"}}
	if health != "" {
		item["State"].(map[string]any)["Health"] = map[string]any{"Status": health}
	}
	return json.Marshal([]any{item})
}

func (f *fakeDocker) did(call string) bool {
	for _, c := range f.calls {
		if c == call {
			return true
		}
	}
	return false
}

func newKeeper(t *testing.T, docker *fakeDocker, now *time.Time) *Keeper {
	k := New(t.TempDir(), docker.run)
	k.Now = func() time.Time { return *now }
	return k
}

func TestStoppedMeshIsStartedAgain(t *testing.T) {
	now := time.Date(2026, 11, 7, 4, 0, 0, 0, time.UTC)
	docker := &fakeDocker{states: map[string]string{"headscale": "exited/unhealthy"}}
	k := newKeeper(t, docker, &now)
	if err := k.Tick(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !docker.did("start kimono-server-headscale-1") {
		t.Fatalf("a stopped mesh should be started: %v", docker.calls)
	}
	var status Status
	data, _ := os.ReadFile(filepath.Join(k.Dir, "status.json"))
	if json.Unmarshal(data, &status) != nil || len(status.Services) != len(Known) || status.Last == nil || !status.Last.OK || status.Last.Asked {
		t.Fatalf("status: %s", data)
	}
}

func TestPortalIsNeverHealedAutomatically(t *testing.T) {
	now := time.Now()
	docker := &fakeDocker{states: map[string]string{"portal": "exited/"}}
	k := newKeeper(t, docker, &now)
	_ = k.Tick(context.Background())
	if docker.did("start kimono-server-portal-1") {
		t.Fatal("the portal is left alone unless asked")
	}
}

func TestUnhealthyMeshIsRestartedOnlyAfterAWhile(t *testing.T) {
	now := time.Date(2026, 11, 7, 4, 0, 0, 0, time.UTC)
	docker := &fakeDocker{states: map[string]string{"headscale": "running/unhealthy"}}
	k := newKeeper(t, docker, &now)
	_ = k.Tick(context.Background())
	if docker.did("restart kimono-server-headscale-1") {
		t.Fatal("restarted at the first unhealthy look")
	}
	now = now.Add(unhealthyAfter + statusEvery)
	_ = k.Tick(context.Background())
	if !docker.did("restart kimono-server-headscale-1") {
		t.Fatalf("an unhealthy mesh should be restarted after %s: %v", unhealthyAfter, docker.calls)
	}
}

func TestHealingIsNotRepeatedRightAway(t *testing.T) {
	now := time.Date(2026, 11, 7, 4, 0, 0, 0, time.UTC)
	docker := &fakeDocker{states: map[string]string{"caddy": "exited/"}}
	k := newKeeper(t, docker, &now)
	_ = k.Tick(context.Background())
	docker.states["caddy"] = "exited/"
	docker.calls = nil
	now = now.Add(statusEvery)
	_ = k.Tick(context.Background())
	if docker.did("start kimono-server-caddy-1") {
		t.Fatal("started again within the heal interval")
	}
}

func TestPortalRequestRestartsOnlyKnownServices(t *testing.T) {
	now := time.Now()
	docker := &fakeDocker{states: map[string]string{}}
	k := newKeeper(t, docker, &now)
	_ = os.MkdirAll(k.Dir, 0755)
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(k.Dir, "request.json"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"id":"r1","service":"headscale"}`)
	_ = k.Tick(context.Background())
	if !docker.did("restart kimono-server-headscale-1") || k.last == nil || k.last.ID != "r1" || !k.last.Asked || !k.last.OK {
		t.Fatalf("asked restart: %v %+v", docker.calls, k.last)
	}
	if _, err := os.Stat(filepath.Join(k.Dir, "request.json")); !os.IsNotExist(err) {
		t.Fatal("request should be consumed")
	}
	docker.calls = nil
	write(`{"id":"r2","service":"reconciler; rm -rf /"}`)
	_ = k.Tick(context.Background())
	for _, call := range docker.calls {
		if !strings.HasPrefix(call, "inspect ") {
			t.Fatalf("unknown service reached docker: %v", docker.calls)
		}
	}
	if k.last == nil || k.last.ID != "r2" || k.last.OK {
		t.Fatalf("refusal not recorded: %+v", k.last)
	}
}
