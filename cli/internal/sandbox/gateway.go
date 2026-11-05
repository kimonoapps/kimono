package sandbox

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/http/cgi"
	"net/http/httputil"
	"net/url"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// GatewayHandler is what sandboxes reach: the model under /anthropic/, Kimono
// Git under /git/, and the person's tools (an MCP server) at /mcp. Each request carries a workspace's capability, which
// is exchanged here for the real credential and never leaves this node.
func (s *Server) GatewayHandler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/anthropic/", http.HandlerFunc(s.serveModel))
	mux.Handle("/git/", http.HandlerFunc(s.serveGit))
	mux.Handle("/mcp", http.HandlerFunc(s.serveTools))
	mux.Handle("/mcp/", http.HandlerFunc(s.serveTools))
	return mux
}

func (s *Server) byToken(token string) *workspace {
	if token == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.byCapability[token]
}

func bearer(header http.Header) string {
	token, _ := strings.CutPrefix(header.Get("Authorization"), "Bearer ")
	return strings.TrimSpace(token)
}

/* ── the model ── */

const oauthBeta = "oauth-2025-04-20"

// swapModelCredential replaces a sandbox's capability with the real
// credential: an API key travels as x-api-key, a Claude subscription token as
// a bearer with the OAuth beta.
func swapModelCredential(header http.Header, token string) {
	header.Del("X-Api-Key")
	header.Del("Authorization")
	if strings.HasPrefix(token, "sk-ant-oat") {
		header.Set("Authorization", "Bearer "+token)
		betas := []string{}
		for _, value := range header.Values("Anthropic-Beta") {
			for _, beta := range strings.Split(value, ",") {
				if beta = strings.TrimSpace(beta); beta != "" && beta != oauthBeta {
					betas = append(betas, beta)
				}
			}
		}
		header.Set("Anthropic-Beta", strings.Join(append(betas, oauthBeta), ","))
		return
	}
	header.Set("X-Api-Key", token)
}

func (s *Server) serveModel(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("X-Api-Key")
	if token == "" {
		token = bearer(r.Header)
	}
	space := s.byToken(token)
	if space == nil {
		writeError(w, 401, "This sandbox has no model access.")
		return
	}
	space.mu.Lock()
	real := space.model.Token
	space.mu.Unlock()
	if real == "" {
		writeError(w, 401, "Kimono Code has no Claude credential yet.")
		return
	}
	upstream, err := url.Parse(s.cfg.AnthropicUpstream)
	if err != nil {
		writeError(w, 502, "The model gateway is misconfigured.")
		return
	}
	s.touch(space.id)
	proxy := &httputil.ReverseProxy{
		Rewrite: func(out *httputil.ProxyRequest) {
			out.SetURL(upstream)
			out.Out.URL.Path = strings.TrimRight(upstream.Path, "/") + strings.TrimPrefix(r.URL.Path, "/anthropic")
			out.Out.URL.RawPath = ""
			out.Out.Host = upstream.Host
			swapModelCredential(out.Out.Header, real)
		},
		ModifyResponse: func(response *http.Response) error {
			s.usage.credit(space.id, readUsage(response.Header))
			return nil
		},
		FlushInterval: -1,
	}
	proxy.ServeHTTP(w, r)
}

/* ── tools ── */

// serveTools carries a sandbox's MCP calls to its person's tool session, with
// the session's own headers in place of the sandbox's capability. Streams
// (server-sent events) pass as they arrive; the session id header passes both ways.
func (s *Server) serveTools(w http.ResponseWriter, r *http.Request) {
	space := s.byToken(bearer(r.Header))
	if space == nil {
		writeError(w, 401, "This sandbox has no tools.")
		return
	}
	space.mu.Lock()
	tools := space.tools
	space.mu.Unlock()
	if tools.URL == "" {
		writeError(w, 404, "No tools are connected for this person.")
		return
	}
	upstream, err := url.Parse(tools.URL)
	if err != nil {
		writeError(w, 502, "The tools address is misconfigured.")
		return
	}
	s.touch(space.id)
	proxy := &httputil.ReverseProxy{
		Rewrite: func(out *httputil.ProxyRequest) {
			out.SetURL(upstream)
			out.Out.URL.Path = strings.TrimRight(upstream.Path, "/") + strings.TrimPrefix(r.URL.Path, "/mcp")
			if out.Out.URL.Path == "" {
				out.Out.URL.Path = "/"
			}
			out.Out.URL.RawPath = ""
			out.Out.Host = upstream.Host
			out.Out.Header.Del("Authorization")
			out.Out.Header.Del("X-Api-Key")
			for name, value := range tools.Headers {
				out.Out.Header.Set(name, value)
			}
		},
		FlushInterval: -1,
	}
	proxy.ServeHTTP(w, r)
}

/* ── Kimono Git ── */

var gitPath = regexp.MustCompile(`^([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+?)(?:\.git)?/(info/refs|git-upload-pack|git-receive-pack)$`)

// gitAllowed says whether a broker request is plain smart-HTTP for the
// workspace's own repository, and whether it pushes.
func gitAllowed(method, rest, service string, repo Repo) (push bool, ok bool) {
	match := gitPath.FindStringSubmatch(rest)
	if match == nil || !strings.EqualFold(match[1], repo.Owner) || !strings.EqualFold(match[2], repo.Name) {
		return false, false
	}
	switch match[3] {
	case "info/refs":
		if method != http.MethodGet || (service != "git-upload-pack" && service != "git-receive-pack") {
			return false, false
		}
		return service == "git-receive-pack", true
	case "git-upload-pack":
		return false, method == http.MethodPost
	default:
		return true, method == http.MethodPost
	}
}

// pushedRefs reads the commands at the start of a receive-pack request — one
// pkt-line per ref, up to a flush — and returns them with the bytes consumed.
func pushedRefs(body *bufio.Reader) ([]string, []byte, error) {
	var consumed bytes.Buffer
	refs := []string{}
	for {
		size := make([]byte, 4)
		if _, err := io.ReadFull(body, size); err != nil {
			return nil, nil, fmt.Errorf("short push request")
		}
		consumed.Write(size)
		length, err := strconv.ParseUint(string(size), 16, 16)
		if err != nil {
			return nil, nil, fmt.Errorf("malformed push request")
		}
		if length == 0 {
			return refs, consumed.Bytes(), nil
		}
		if length < 4 {
			return nil, nil, fmt.Errorf("malformed push request")
		}
		line := make([]byte, length-4)
		if _, err := io.ReadFull(body, line); err != nil {
			return nil, nil, fmt.Errorf("short push request")
		}
		consumed.Write(line)
		text, _, _ := strings.Cut(string(line), "\x00")
		text = strings.TrimRight(text, "\n")
		if strings.HasPrefix(text, "shallow ") {
			continue
		}
		fields := strings.Fields(text)
		if len(fields) != 3 {
			return nil, nil, fmt.Errorf("unsupported push request")
		}
		refs = append(refs, fields[2])
	}
}

func (s *Server) serveGit(w http.ResponseWriter, r *http.Request) {
	space := s.byToken(bearer(r.Header))
	if space == nil {
		writeError(w, 401, "This sandbox has no Kimono Git access.")
		return
	}
	space.mu.Lock()
	repo, token, base := space.repo, space.git.Token, space.base
	space.mu.Unlock()
	rest := strings.TrimPrefix(r.URL.Path, "/git/")
	push, ok := gitAllowed(r.Method, rest, r.URL.Query().Get("service"), repo)
	if !ok {
		writeError(w, 403, "Sandboxes can only fetch and push their own repository.")
		return
	}
	s.touch(space.id)
	if push && r.Method == http.MethodPost {
		// The agent may push its own branch, and nothing else.
		var source io.Reader = r.Body
		if strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip") {
			unzipped, err := gzip.NewReader(r.Body)
			if err != nil {
				writeError(w, 400, "malformed push request")
				return
			}
			source = unzipped
			r.Header.Del("Content-Encoding")
		}
		buffered := bufio.NewReader(source)
		refs, consumed, err := pushedRefs(buffered)
		if err != nil {
			writeError(w, 400, err.Error())
			return
		}
		for _, ref := range refs {
			if ref != "refs/heads/"+repo.Branch {
				writeError(w, 403, "Sandboxes can only push to "+repo.Branch+".")
				return
			}
		}
		r.Body = io.NopCloser(io.MultiReader(bytes.NewReader(consumed), buffered))
		r.ContentLength = -1
		r.Header.Del("Content-Length")
	}
	r.Header.Del("Authorization")

	if s.cfg.DevGitDir != "" && base == "http://"+DevGitHost {
		s.serveDevGit(w, r)
		return
	}
	upstream, err := url.Parse(base)
	if err != nil {
		writeError(w, 502, "The Git broker is misconfigured.")
		return
	}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(out *httputil.ProxyRequest) {
			out.SetURL(upstream)
			out.Out.URL.Path = strings.TrimRight(upstream.Path, "/") + "/" + rest
			out.Out.URL.RawPath = ""
			out.Out.Host = upstream.Host
			out.Out.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(token+":x-oauth-basic")))
		},
		FlushInterval: -1,
	}
	proxy.ServeHTTP(w, r)
}

// serveDevGit answers from bare repositories on disk with git http-backend,
// so a node can be exercised without Kimono Git. Development only.
func (s *Server) serveDevGit(w http.ResponseWriter, r *http.Request) {
	execPath, err := exec.Command("git", "--exec-path").Output()
	if err != nil {
		writeError(w, 500, "git isn't installed on this node.")
		return
	}
	handler := &cgi.Handler{
		Path: filepath.Join(strings.TrimSpace(string(execPath)), "git-http-backend"),
		Root: "/git",
		Env:  []string{"GIT_PROJECT_ROOT=" + s.cfg.DevGitDir, "GIT_HTTP_EXPORT_ALL=1", "REMOTE_USER=kimono"},
	}
	handler.ServeHTTP(w, r)
}
