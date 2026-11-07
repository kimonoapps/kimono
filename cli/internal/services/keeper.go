// Package services keeps Kimono's own containers (sign-in, the mesh, the
// proxy, the database) running, and lets an administrator restart one from
// the Portal. The reconciler runs it between deployment passes: it already
// holds the Docker socket, and the Portal must never hold it.
//
// The Portal and the keeper share only two files in the Portal's state
// directory: services/request.json, which the Portal writes and the keeper
// removes, and services/status.json, which the keeper writes and the Portal
// reads. A request names a service from a fixed list; nothing else in it is
// ever passed to Docker.
package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Project is the Compose project Kimono's own services run in.
const Project = "kimono-server"

// Service is one container the keeper looks after.
type Service struct {
	ID string `json:"id"`
	// Heal: started again when it is found stopped. The Portal and the
	// reconciler are left alone; the first is serving the request, the second
	// is this process.
	Heal bool `json:"-"`
	// RestartWhenUnhealthy: restarted when its health check has failed for a
	// while. The mesh coordinator can come up before sign-in answers and then
	// never recover on its own.
	RestartWhenUnhealthy bool `json:"-"`
	// Restartable from the Portal.
	Restartable bool `json:"-"`
}

// Known is every service the keeper reports on, in the order the Portal lists them.
var Known = []Service{
	{ID: "authentik-server", Heal: true, Restartable: true},
	{ID: "authentik-worker", Heal: true, Restartable: true},
	{ID: "headscale", Heal: true, RestartWhenUnhealthy: true, Restartable: true},
	{ID: "caddy", Heal: true, Restartable: true},
	{ID: "postgresql", Heal: true, Restartable: true},
	{ID: "portal", Restartable: true},
}

func find(id string) (Service, bool) {
	for _, service := range Known {
		if service.ID == id {
			return service, true
		}
	}
	return Service{}, false
}

// Container is the name Compose gives a service's one container.
func Container(id string) string { return Project + "-" + id + "-1" }

const (
	statusEvery    = 15 * time.Second
	healEvery      = 2 * time.Minute
	unhealthyAfter = 3 * time.Minute
)

// Docker runs the docker CLI and returns what it printed.
type Docker func(ctx context.Context, args ...string) ([]byte, error)

type Keeper struct {
	Dir    string
	Docker Docker
	Now    func() time.Time

	lastStatus time.Time
	lastHeal   map[string]time.Time
	unhealthy  map[string]time.Time
	last       *Outcome
}

// CLI runs the real docker command, giving up after a couple of minutes.
func CLI(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	if err != nil && len(out) > 0 {
		return out, errors.New(firstLine(string(out)))
	}
	return out, err
}

// Run ticks the keeper every couple of seconds until ctx ends. It runs beside
// the deployment loop, so a long backup never holds up a restart.
func (k *Keeper) Run(ctx context.Context, every time.Duration) {
	for {
		if err := k.Tick(ctx); err != nil {
			fmt.Fprintf(os.Stderr, "services: %v\n", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
}

func New(stateDir string, docker Docker) *Keeper {
	return &Keeper{Dir: filepath.Join(stateDir, "services"), Docker: docker, Now: time.Now}
}

// State is what the keeper last saw of one service.
type State struct {
	ID        string `json:"id"`
	State     string `json:"state"`  // running, restarting, exited, missing, …
	Health    string `json:"health"` // healthy, unhealthy, starting, or empty without a check
	StartedAt string `json:"startedAt,omitempty"`
}

// Outcome is how the last restart, asked for or automatic, went.
type Outcome struct {
	ID      string `json:"id,omitempty"`
	Service string `json:"service"`
	Asked   bool   `json:"asked"`
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
	At      string `json:"at"`
}

type Status struct {
	UpdatedAt string   `json:"updatedAt"`
	Services  []State  `json:"services"`
	Last      *Outcome `json:"last,omitempty"`
}

type request struct {
	ID      string `json:"id"`
	Service string `json:"service"`
}

// Tick handles a waiting request at once, and every few seconds looks at
// every service, starts what has stopped and writes what it saw.
func (k *Keeper) Tick(ctx context.Context) error {
	if k.lastHeal == nil {
		k.lastHeal, k.unhealthy = map[string]time.Time{}, map[string]time.Time{}
	}
	asked := k.handleRequest(ctx)
	now := k.Now()
	if !asked && now.Sub(k.lastStatus) < statusEvery {
		return nil
	}
	k.lastStatus = now
	states := k.inspect(ctx)
	k.heal(ctx, states, now)
	return k.writeStatus(states)
}

func (k *Keeper) handleRequest(ctx context.Context) bool {
	path := filepath.Join(k.Dir, "request.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	_ = os.Remove(path)
	var asked request
	if json.Unmarshal(data, &asked) != nil {
		return true
	}
	service, ok := find(asked.Service)
	if !ok || !service.Restartable {
		k.record(Outcome{ID: asked.ID, Service: asked.Service, Asked: true, Message: "That isn't something Kimono can restart."})
		return true
	}
	k.restart(ctx, service.ID, asked.ID, true)
	return true
}

// restart restarts a running container and starts a stopped one.
func (k *Keeper) restart(ctx context.Context, id, requestID string, asked bool) {
	verb := "restart"
	if state := k.inspectOne(ctx, id); state.State != "running" && state.State != "restarting" {
		verb = "start"
	}
	_, err := k.Docker(ctx, verb, Container(id))
	outcome := Outcome{ID: requestID, Service: id, Asked: asked, OK: err == nil}
	if err != nil {
		outcome.Message = firstLine(err.Error())
	}
	k.record(outcome)
}

func (k *Keeper) record(outcome Outcome) {
	outcome.At = k.Now().UTC().Format(time.RFC3339)
	k.last = &outcome
}

// heal starts what has stopped and restarts what has stayed unhealthy, each
// at most every couple of minutes, so a service that keeps failing is retried
// rather than hammered.
func (k *Keeper) heal(ctx context.Context, states []State, now time.Time) {
	for _, state := range states {
		service, _ := find(state.ID)
		if state.Health == "unhealthy" {
			if _, seen := k.unhealthy[state.ID]; !seen {
				k.unhealthy[state.ID] = now
			}
		} else {
			delete(k.unhealthy, state.ID)
		}
		if now.Sub(k.lastHeal[state.ID]) < healEvery {
			continue
		}
		stopped := state.State == "exited" || state.State == "created" || state.State == "dead"
		stuck := service.RestartWhenUnhealthy && state.Health == "unhealthy" && now.Sub(k.unhealthy[state.ID]) >= unhealthyAfter
		if !service.Heal || !(stopped || stuck) {
			continue
		}
		k.lastHeal[state.ID] = now
		delete(k.unhealthy, state.ID)
		k.restart(ctx, state.ID, "", false)
	}
}

type inspected struct {
	State struct {
		Status    string `json:"Status"`
		StartedAt string `json:"StartedAt"`
		Health    *struct {
			Status string `json:"Status"`
		} `json:"Health"`
	} `json:"State"`
}

func (k *Keeper) inspectOne(ctx context.Context, id string) State {
	out, err := k.Docker(ctx, "inspect", Container(id))
	if err != nil {
		return State{ID: id, State: "missing"}
	}
	var found []inspected
	if json.Unmarshal(out, &found) != nil || len(found) == 0 {
		return State{ID: id, State: "missing"}
	}
	state := State{ID: id, State: found[0].State.Status, StartedAt: found[0].State.StartedAt}
	if found[0].State.Health != nil {
		state.Health = found[0].State.Health.Status
	}
	return state
}

func (k *Keeper) inspect(ctx context.Context) []State {
	states := make([]State, 0, len(Known))
	for _, service := range Known {
		states = append(states, k.inspectOne(ctx, service.ID))
	}
	return states
}

func (k *Keeper) writeStatus(states []State) error {
	if err := k.ensureDir(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(Status{UpdatedAt: k.Now().UTC().Format(time.RFC3339), Services: states, Last: k.last}, "", "  ")
	if err != nil {
		return err
	}
	temporary := filepath.Join(k.Dir, ".status.json.tmp")
	if err := os.WriteFile(temporary, append(data, '\n'), 0644); err != nil {
		return err
	}
	return os.Rename(temporary, filepath.Join(k.Dir, "status.json"))
}

// ensureDir makes the shared folder owned like the Portal's state directory
// around it, so the Portal (not root) can still leave its requests there.
func (k *Keeper) ensureDir() error {
	if err := os.MkdirAll(k.Dir, 0755); err != nil {
		return err
	}
	if parent, err := os.Stat(filepath.Dir(k.Dir)); err == nil {
		if owner, ok := parent.Sys().(*syscall.Stat_t); ok {
			_ = os.Chown(k.Dir, int(owner.Uid), int(owner.Gid))
		}
	}
	return nil
}

func firstLine(value string) string {
	value, _, _ = strings.Cut(strings.TrimSpace(value), "\n")
	return value
}
