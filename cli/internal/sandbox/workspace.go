package sandbox

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Repo struct {
	URL    string `json:"url"`
	Owner  string `json:"owner"`
	Name   string `json:"name"`
	Base   string `json:"base"`
	Branch string `json:"branch"`
}

type GitAuth struct {
	Token string `json:"token"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type ModelAuth struct {
	Token string `json:"token"`
}

type ensureRequest struct {
	Repo  Repo      `json:"repo"`
	Git   GitAuth   `json:"git"`
	Model ModelAuth `json:"model"`
	// Owner is the person the task belongs to and Title its name, for the
	// awake caps and for saying which tasks hold the slots.
	Owner string `json:"owner"`
	Title string `json:"title"`
	// Limits are the Portal's own; unset fields keep the node's.
	Limits *Limits `json:"limits"`
}

// workspace is what the node remembers about one sandbox. Credentials live
// here and nowhere else; a restart forgets them until the Portal ensures again.
type workspace struct {
	id         string
	repo       Repo
	git        GitAuth
	model      ModelAuth
	capability string
	// base is the repository's server root, such as https://git.example.com,
	// which the broker forwards to.
	base string

	// op serialises the operations that change the container or the branch.
	op sync.Mutex

	mu         sync.Mutex
	seenShots  map[string]bool
	busy       bool
	cancel     func()
	lastActive time.Time
	// slept are the sandboxes the last ensure put to sleep to make room.
	slept []string
}

func (w *workspace) touch() {
	w.mu.Lock()
	w.lastActive = time.Now()
	w.mu.Unlock()
}

var (
	idPattern   = regexp.MustCompile(`^[a-z0-9-]{1,63}$`)
	namePattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,100}$`)
	refPattern  = regexp.MustCompile(`^[A-Za-z0-9._/-]{1,200}$`)
)

func validID(id string) bool { return idPattern.MatchString(id) }

// validBranch accepts the plain branch names Kimono makes and refuses anything
// git would read as an option, a range or a reflog expression.
func validBranch(ref string) bool {
	if !refPattern.MatchString(ref) || strings.HasPrefix(ref, "-") || strings.HasPrefix(ref, "/") ||
		strings.HasSuffix(ref, "/") || strings.HasSuffix(ref, ".lock") || strings.HasSuffix(ref, ".") {
		return false
	}
	return !strings.Contains(ref, "..") && !strings.Contains(ref, "//") && !strings.Contains(ref, "/.")
}

// repoBase checks a repository address and returns the server root it lives
// under, with any path prefix Kimono Git is served from.
func repoBase(repo Repo, dev bool) (string, error) {
	if !namePattern.MatchString(repo.Owner) || !namePattern.MatchString(repo.Name) {
		return "", fmt.Errorf("That repository name isn't one Kimono can use.")
	}
	if !validBranch(repo.Base) || !validBranch(repo.Branch) {
		return "", fmt.Errorf("That branch name isn't one Kimono can use.")
	}
	parsed, err := url.Parse(repo.URL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", fmt.Errorf("That repository address isn't one Kimono can use.")
	}
	switch {
	case parsed.Scheme == "https":
	case parsed.Scheme == "http" && dev && (parsed.Host == DevGitHost || isLoopbackHost(parsed.Hostname())):
		/* Development only: a Kimono Git on this machine, such as a throwaway Forgejo. */
	default:
		return "", fmt.Errorf("Kimono Git must be reached over HTTPS.")
	}
	suffixes := []string{"/" + repo.Owner + "/" + repo.Name + ".git", "/" + repo.Owner + "/" + repo.Name}
	for _, suffix := range suffixes {
		if strings.HasSuffix(strings.ToLower(parsed.Path), strings.ToLower(suffix)) {
			prefix := strings.TrimRight(parsed.Path[:len(parsed.Path)-len(suffix)], "/")
			return parsed.Scheme + "://" + parsed.Host + prefix, nil
		}
	}
	return "", fmt.Errorf("The repository address doesn't match %s/%s.", repo.Owner, repo.Name)
}

func randomToken() string {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		panic(err)
	}
	return "kimono-sbx-" + hex.EncodeToString(buffer)
}

// ensure makes the workspace's sandbox exist, run, and sit on its branch.
func (s *Server) ensure(ctx context.Context, id string, request ensureRequest) (*workspace, string, error) {
	dev := s.cfg.DevGitDir != ""
	base, err := repoBase(request.Repo, dev)
	if err != nil {
		return nil, "", problem(400, err.Error())
	}
	if request.Git.Token == "" && !(dev && strings.Contains(request.Repo.URL, "://"+DevGitHost+"/")) {
		return nil, "", problem(400, "A Kimono Git token is required.")
	}
	s.mu.Lock()
	w := s.spaces[id]
	if w == nil {
		w = &workspace{id: id, capability: randomToken()}
		s.spaces[id] = w
		s.byCapability[w.capability] = w
	}
	s.mu.Unlock()

	w.op.Lock()
	defer w.op.Unlock()
	if w.repo.URL != "" && (w.repo.URL != request.Repo.URL || w.repo.Branch != request.Repo.Branch) {
		return nil, "", problem(409, "This workspace already belongs to another repository or branch.")
	}
	w.mu.Lock()
	w.repo, w.git, w.model, w.base = request.Repo, request.Git, request.Model, base
	w.lastActive = time.Now()
	w.mu.Unlock()

	state, err := s.docker.containerState(ctx, id)
	if err != nil {
		return nil, "", err
	}
	if label := s.repoLabel(ctx, id); state != "" && label != "" && label != request.Repo.Owner+"/"+request.Repo.Name {
		return nil, "", problem(409, "This workspace already belongs to another repository.")
	}
	s.mu.Lock()
	s.limits = s.limits.merge(request.Limits)
	s.mu.Unlock()
	owner, title := strings.TrimSpace(request.Owner), strings.TrimSpace(request.Title)
	if len(owner) > 100 {
		owner = owner[:100]
	}
	if runes := []rune(title); len(runes) > 120 {
		title = string(runes[:120])
	}
	s.remember(id, request.Repo, owner, title)
	// Waking covers every sleep, a removed container included; only a sandbox
	// that never existed (or lost its files) is made from scratch.
	_, slept, err := s.wakeFor(ctx, id)
	if err != nil {
		var refused *apiProblem
		if !errors.As(err, &refused) || refused.status != 404 {
			return nil, "", err
		}
		s.room.Lock()
		more, err := s.makeRoom(ctx, id)
		slept = append(slept, more...)
		if err == nil {
			err = s.create(ctx, id, request.Repo)
		}
		s.room.Unlock()
		if err != nil {
			return nil, "", err
		}
	}
	w.mu.Lock()
	w.slept = slept
	w.mu.Unlock()
	if err := s.checkout(ctx, w); err != nil {
		return nil, "", err
	}
	return w, "ready", nil
}

func (s *Server) repoLabel(ctx context.Context, id string) string {
	out, err := s.docker.run(ctx, nil, "container", "inspect", "-f", `{{index .Config.Labels "kimono.repo"}}`, containerName(id))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func (s *Server) create(ctx context.Context, id string, repo Repo) error {
	name := containerName(id)
	if _, err := s.docker.run(ctx, nil, "volume", "create", "--label", "kimono.sandbox="+id, name); err != nil {
		return err
	}
	args := []string{"run", "-d", "--name", name,
		"--label", "kimono.sandbox=" + id, "--label", "kimono.repo=" + repo.Owner + "/" + repo.Name,
		"--hostname", "sandbox", "--network", s.cfg.Network,
		"--pids-limit", strconv.Itoa(s.cfg.Pids),
		"--init", "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
		"--user", "agent", "--workdir", "/workspace",
		"-v", name + ":/workspace"}
	args = append(args, s.limitsNow().dockerArgs()...)
	if s.runtime == "runsc" {
		args = append(args, "--runtime", "runsc")
	}
	/* No names: Docker's own resolver would otherwise look them up from inside, past the firewall. */
	args = append(args, "--dns", "127.0.0.1")
	if s.firewall != nil {
		if err := s.recheckFirewall(ctx); err != nil {
			return fmt.Errorf("the sandbox firewall: %w", err)
		}
	}
	args = append(args, s.cfg.Image, "sleep", "infinity")
	if _, err := s.docker.run(ctx, nil, args...); err != nil {
		return fmt.Errorf("start the sandbox: %w", err)
	}
	return s.probeOffline(ctx, name)
}

// probeOffline tries the web from inside a new sandbox, and removes the
// sandbox if it gets through: a sandbox that can reach the web never runs.
// Without the firewall (Docker Desktop, development) it only says so.
func (s *Server) probeOffline(ctx context.Context, name string) error {
	probe := `timeout 3 bash -c 'exec 3<>/dev/tcp/` + offlineProbe + `' 2>/dev/null && echo reached || echo blocked`
	out, err := s.docker.run(ctx, nil, "exec", name, "sh", "-c", probe)
	if err != nil {
		return fmt.Errorf("check the sandbox is offline: %w", err)
	}
	if strings.TrimSpace(string(out)) != "reached" {
		return nil
	}
	if s.firewall == nil {
		s.cfg.Logf("sandbox %s can reach the web (no firewall here); development only", name)
		return nil
	}
	_, _ = s.docker.run(ctx, nil, "rm", "-f", name)
	return fmt.Errorf("the sandbox could reach the web, so Kimono won't run it; check this node's firewall (kimono node sandboxes status)")
}

// offlineProbe is a public address a sandbox must not reach: Cloudflare's resolver, on HTTPS.
const offlineProbe = "1.1.1.1/443"

// checkoutScript clones on first use and otherwise only moves onto the
// workspace's branch when it is somewhere else, so the agent's work is never
// reset under it.
const checkoutScript = `set -e
url=$1 base=$2 branch=$3
cd /workspace
if [ ! -d .git ]; then git clone --quiet "$url" /workspace; fi
git remote set-url origin "$url"
git fetch --quiet --prune origin
current=$(git symbolic-ref --quiet --short HEAD || true)
if [ "$current" != "$branch" ]; then
  if git show-ref --verify --quiet "refs/heads/$branch"; then git checkout --quiet "$branch"
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then git checkout --quiet -b "$branch" --track "origin/$branch"
  else git checkout --quiet --no-track -b "$branch" "origin/$base"; fi
fi`

func (s *Server) checkout(ctx context.Context, w *workspace) error {
	_, err := s.exec(ctx, w, nil, nil, "sh", "-c", checkoutScript, "checkout", w.repo.URL, w.repo.Base, w.repo.Branch)
	if err != nil {
		return fmt.Errorf("Couldn't get %s/%s ready: %w", w.repo.Owner, w.repo.Name, err)
	}
	return nil
}

// environment is what every command in a sandbox sees: the model and Kimono
// Git through this node, behind a capability that only works for this workspace.
func (s *Server) environment(w *workspace) []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	gateway := strings.TrimRight(s.gatewayURL, "/")
	env := []string{
		"HOME=/home/agent",
		"GIT_TERMINAL_PROMPT=0",
		"GIT_CONFIG_COUNT=3",
		"GIT_CONFIG_KEY_0=url." + gateway + "/git/.insteadOf",
		"GIT_CONFIG_VALUE_0=" + w.base + "/",
		"GIT_CONFIG_KEY_1=http." + gateway + "/git/.extraHeader",
		"GIT_CONFIG_VALUE_1=Authorization: Bearer " + w.capability,
		"GIT_CONFIG_KEY_2=credential.helper",
		"GIT_CONFIG_VALUE_2=",
		"ANTHROPIC_BASE_URL=" + gateway + "/anthropic",
		"ANTHROPIC_API_KEY=" + w.capability,
		"DISABLE_AUTOUPDATER=1",
		"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
	}
	if w.git.Name != "" {
		env = append(env, "GIT_AUTHOR_NAME="+w.git.Name, "GIT_COMMITTER_NAME="+w.git.Name)
	}
	if w.git.Email != "" {
		env = append(env, "GIT_AUTHOR_EMAIL="+w.git.Email, "GIT_COMMITTER_EMAIL="+w.git.Email)
	}
	return env
}

// exec runs a command in the workspace's container as the agent, in the
// repository, with the sandbox environment plus extra.
func (s *Server) exec(ctx context.Context, w *workspace, extra []string, stdin io.Reader, command ...string) ([]byte, error) {
	return s.docker.run(ctx, stdin, s.execArgs(w, extra, stdin != nil, command...)...)
}

func (s *Server) execArgs(w *workspace, extra []string, interactive bool, command ...string) []string {
	args := []string{"exec"}
	if interactive {
		args = append(args, "-i")
	}
	args = append(args, "-u", "agent", "-w", "/workspace")
	for _, value := range append(s.environment(w), extra...) {
		args = append(args, "-e", value)
	}
	args = append(args, containerName(w.id))
	return append(args, command...)
}

// running wakes a sandbox from whatever sleep it is in, for calls that only
// need the container (files, changes). It needs no credentials.
func (s *Server) running(ctx context.Context, id string) (*workspace, error) {
	restarted, err := s.wake(ctx, id)
	if err != nil {
		return nil, err
	}
	if restarted {
		s.reviveServe(id)
	}
	s.mu.Lock()
	w := s.spaces[id]
	if w == nil {
		// Known to Docker but not since this node started: usable for reading,
		// and the next ensure brings its credentials back.
		w = &workspace{id: id, capability: randomToken()}
		s.spaces[id] = w
		s.byCapability[w.capability] = w
	}
	s.mu.Unlock()
	w.touch()
	return w, nil
}

// remembered returns a workspace the Portal has ensured since this node started.
func (s *Server) remembered(id string) (*workspace, error) {
	s.mu.Lock()
	w := s.spaces[id]
	s.mu.Unlock()
	if w == nil || w.repo.URL == "" {
		return nil, problem(409, "Ensure the workspace first.")
	}
	return w, nil
}

func (s *Server) remove(ctx context.Context, id string) error {
	s.mu.Lock()
	if w := s.spaces[id]; w != nil {
		w.mu.Lock()
		if w.cancel != nil {
			w.cancel()
		}
		w.mu.Unlock()
		delete(s.byCapability, w.capability)
		delete(s.spaces, id)
	}
	s.mu.Unlock()
	s.clearPreview(id)
	s.forget(id)
	name := containerName(id)
	if _, err := s.docker.run(ctx, nil, "rm", "-f", "-v", name); err != nil && !strings.Contains(strings.ToLower(err.Error()), "no such") {
		return err
	}
	if _, err := s.docker.run(ctx, nil, "volume", "rm", "-f", name); err != nil && !strings.Contains(strings.ToLower(err.Error()), "no such") {
		return err
	}
	return nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
