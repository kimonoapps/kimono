package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// controlPlaneUser owns the appliance's own mesh nodes. It is the principal the
// generated access policy already names, and keeping service nodes under it is
// what stops them sharing a user with the person who happens to sign in first.
const controlPlaneUser = "kimono-control-plane"

type headscaleUser struct {
	ID   uint64
	Name string
}

// parseHeadscaleUsers reads `headscale users list -o json`. Headscale prints a
// version notice before the payload and encodes identifiers as strings, so the
// document is found rather than assumed to start at the first byte.
func parseHeadscaleUsers(output []byte) ([]headscaleUser, error) {
	start := bytes.IndexByte(output, '[')
	if start < 0 {
		return nil, fmt.Errorf("no user list in Headscale's reply")
	}
	var raw []struct {
		ID   json.Number `json:"id"`
		Name string      `json:"name"`
	}
	if err := json.Unmarshal(output[start:], &raw); err != nil {
		return nil, fmt.Errorf("read Headscale users: %w", err)
	}
	users := make([]headscaleUser, 0, len(raw))
	for _, item := range raw {
		identifier, err := strconv.ParseUint(item.ID.String(), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("Headscale reported user %q with identifier %q", item.Name, item.ID)
		}
		users = append(users, headscaleUser{ID: identifier, Name: item.Name})
	}
	return users, nil
}

func (m *Manager) headscaleUsers() ([]headscaleUser, error) {
	output, err := m.Runner.OutputCombined("docker", "exec", "kimono-server-headscale-1",
		"headscale", "users", "list", "-o", "json")
	if err != nil {
		return nil, fmt.Errorf("list Headscale users: %w", err)
	}
	return parseHeadscaleUsers(output)
}

// ensureControlPlaneUser returns the identifier an enrollment key is minted
// against, creating the user the first time. A preauthkey belongs to a user,
// and without one Headscale has no owner to register the node under.
func (m *Manager) ensureControlPlaneUser() (uint64, error) {
	users, err := m.headscaleUsers()
	if err != nil {
		return 0, err
	}
	for _, user := range users {
		if user.Name == controlPlaneUser {
			return user.ID, nil
		}
	}
	if err := m.Runner.Run("docker", "exec", "kimono-server-headscale-1",
		"headscale", "users", "create", controlPlaneUser); err != nil {
		return 0, fmt.Errorf("create the %s user: %w", controlPlaneUser, err)
	}
	users, err = m.headscaleUsers()
	if err != nil {
		return 0, err
	}
	for _, user := range users {
		if user.Name == controlPlaneUser {
			return user.ID, nil
		}
	}
	return 0, fmt.Errorf("%s was created but Headscale did not list it", controlPlaneUser)
}

// reportDuplicateMeshUsers warns about users sharing a name. The access policy
// addresses a person by name, so two users called the same thing make every
// rule about them ambiguous: one user's devices are covered and the other's
// are silently invisible, with nothing logged anywhere.
func (m *Manager) reportDuplicateMeshUsers() {
	users, err := m.headscaleUsers()
	if err != nil {
		_, _ = fmt.Fprintf(m.Runner.Stdout, "Could not read Kimono VPN users: %s\n", err)
		return
	}
	byName := map[string][]uint64{}
	for _, user := range users {
		byName[user.Name] = append(byName[user.Name], user.ID)
	}
	duplicates := false
	for _, name := range sortedNames(byName) {
		identifiers := byName[name]
		if len(identifiers) < 2 {
			continue
		}
		duplicates = true
		_, _ = fmt.Fprintf(m.Runner.Stdout,
			"Kimono VPN: %d users are named %q (identifiers %s). Devices are split between them and cannot see each other; rename all but one with `headscale users rename`.\n",
			len(identifiers), name, joinUint(identifiers))
	}
	if !duplicates {
		_, _ = fmt.Fprintln(m.Runner.Stdout, "Kimono VPN users are unambiguous.")
	}
}

func sortedNames(values map[string][]uint64) []string {
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func joinUint(values []uint64) string {
	text := make([]string, 0, len(values))
	for _, value := range values {
		text = append(text, strconv.FormatUint(value, 10))
	}
	return strings.Join(text, ", ")
}
