package sandbox

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

type Server struct {
	cfg        Config
	docker     docker
	runtime    string
	gatewayURL string

	mu           sync.Mutex
	spaces       map[string]*workspace
	byCapability map[string]*workspace
	// previews are the live apps, by workspace id; kept in StateDir.
	previews map[string]*preview
	// records keep each sandbox's repository and last activity; kept in StateDir.
	records      map[string]*record
	recordsSaved time.Time
	wakeLocks    map[string]*sync.Mutex
	wakings      map[string]*waking
	// now is the clock, replaceable in tests; started is when this node began.
	now     func() time.Time
	started time.Time
}

// apiProblem is a refusal the Portal shows as it is.
type apiProblem struct {
	status  int
	message string
}

func (p *apiProblem) Error() string { return p.message }

func problem(status int, message string) error { return &apiProblem{status: status, message: message} }

func New(cfg Config) (*Server, error) {
	if err := cfg.defaults(); err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, docker: docker{bin: cfg.Docker}, spaces: map[string]*workspace{}, byCapability: map[string]*workspace{}, previews: map[string]*preview{},
		records: map[string]*record{}, wakeLocks: map[string]*sync.Mutex{}, wakings: map[string]*waking{}, now: time.Now}
	s.started = s.now()
	s.loadPreviews()
	s.loadRecords()
	return s, nil
}

// Run prepares Docker, then serves the API and the gateway until ctx ends.
func (s *Server) Run(ctx context.Context) error {
	gatewayIP, err := s.docker.ensureNetwork(ctx, s.cfg.Network)
	if err != nil {
		return err
	}
	switch {
	case s.cfg.Runtime != "":
		s.runtime = s.cfg.Runtime
	case s.docker.hasRuntime(ctx, "runsc"):
		s.runtime = "runsc"
	default:
		s.runtime = "runc"
		s.cfg.Logf("gVisor (runsc) isn't installed; sandboxes run under runc")
	}
	gatewayListen := s.cfg.GatewayListen
	if gatewayListen == "" {
		if dockerDesktop {
			gatewayListen = "127.0.0.1:7481"
		} else {
			gatewayListen = net.JoinHostPort(gatewayIP, "7481")
		}
	}
	s.gatewayURL = s.cfg.GatewayURL
	if s.gatewayURL == "" {
		_, port, err := net.SplitHostPort(gatewayListen)
		if err != nil {
			return fmt.Errorf("gateway address %q: %w", gatewayListen, err)
		}
		host := gatewayIP
		if dockerDesktop {
			host = "host.docker.internal"
		}
		s.gatewayURL = "http://" + net.JoinHostPort(host, port)
	}

	api := &http.Server{Addr: s.cfg.Listen, Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
	gateway := &http.Server{Addr: gatewayListen, Handler: s.GatewayHandler(), ReadHeaderTimeout: 10 * time.Second}
	previews := &http.Server{Addr: s.cfg.PreviewListen, Handler: s.PreviewHandler(), ReadHeaderTimeout: 10 * time.Second}
	failed := make(chan error, 3)
	for _, server := range []*http.Server{api, gateway, previews} {
		go func(server *http.Server) {
			if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				failed <- err
			}
		}(server)
	}
	s.cfg.Logf("Kimono Code sandboxes: API on %s, gateway on %s (containers use %s), previews on %s, runtime %s; pause after %s, stop after %s", s.cfg.Listen, gatewayListen, s.gatewayURL, s.cfg.PreviewListen, s.runtime, s.cfg.PauseAfter, s.cfg.StopAfter)

	// Whatever went overdue while the node was down sleeps now, not later.
	s.sweep(ctx)
	ticker := time.NewTicker(s.sweepEvery())
	defer ticker.Stop()
	for {
		select {
		case err := <-failed:
			_ = api.Close()
			_ = gateway.Close()
			_ = previews.Close()
			return err
		case <-ticker.C:
			s.sweep(ctx)
		case <-ctx.Done():
			shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = api.Shutdown(shutdown)
			_ = gateway.Shutdown(shutdown)
			_ = previews.Shutdown(shutdown)
			return nil
		}
	}
}

// Handler is the API the Portal calls.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "version": Version, "runtime": s.runtime})
	})
	mux.HandleFunc("PUT /v1/workspaces/{id}", s.workspaceCall(s.handleEnsure))
	mux.HandleFunc("GET /v1/workspaces/{id}", s.workspaceCall(s.handleState))
	mux.HandleFunc("DELETE /v1/workspaces/{id}", s.workspaceCall(s.handleDelete))
	mux.HandleFunc("POST /v1/workspaces/{id}/turns", s.workspaceCall(s.handleTurn))
	mux.HandleFunc("POST /v1/workspaces/{id}/cancel", s.workspaceCall(s.handleCancel))
	mux.HandleFunc("GET /v1/workspaces/{id}/files", s.workspaceCall(s.handleFiles))
	mux.HandleFunc("GET /v1/workspaces/{id}/file", s.workspaceCall(s.handleFile))
	mux.HandleFunc("PUT /v1/workspaces/{id}/attachments", s.workspaceCall(s.handleAttachment))
	mux.HandleFunc("GET /v1/workspaces/{id}/changes", s.workspaceCall(s.handleChanges))
	mux.HandleFunc("POST /v1/workspaces/{id}/publish", s.workspaceCall(s.handlePublish))
	mux.HandleFunc("GET /v1/workspaces/{id}/outbox/{name}", s.workspaceCall(s.handleOutbox))
	mux.HandleFunc("GET /v1/workspaces/{id}/preview", s.workspaceCall(s.handlePreview))
	mux.HandleFunc("DELETE /v1/workspaces/{id}/preview", s.workspaceCall(s.handleStopPreview))
	return s.authorized(mux)
}

func (s *Server) authorized(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(presented), []byte(s.cfg.Key)) != 1 {
			writeError(w, 401, "This node doesn't know that key.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type workspaceHandler func(w http.ResponseWriter, r *http.Request, id string) error

func (s *Server) workspaceCall(handle workspaceHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validID(id) {
			writeError(w, 400, "That workspace id isn't one Kimono can use.")
			return
		}
		if err := handle(w, r, id); err != nil {
			var refused *apiProblem
			if errors.As(err, &refused) {
				writeError(w, refused.status, refused.message)
				return
			}
			s.cfg.Logf("%s %s: %v", r.Method, r.URL.Path, err)
			writeError(w, 500, "The sandbox couldn't do that: "+err.Error())
		}
	}
}

func (s *Server) handleEnsure(w http.ResponseWriter, r *http.Request, id string) error {
	var request ensureRequest
	if err := readJSON(r, 64<<10, &request); err != nil {
		return err
	}
	space, state, err := s.ensure(r.Context(), id, request)
	if err != nil {
		return err
	}
	s.reviveServe(id)
	writeJSON(w, 200, map[string]any{"id": id, "state": state, "branch": space.repo.Branch, "runtime": s.runtime, "preview": s.previewJSON(id)})
	return nil
}

func (s *Server) handleState(w http.ResponseWriter, r *http.Request, id string) error {
	state, err := s.docker.containerState(r.Context(), id)
	if err != nil {
		return err
	}
	s.mu.Lock()
	space := s.spaces[id]
	s.mu.Unlock()
	branch := ""
	busy := false
	if space != nil {
		space.mu.Lock()
		branch, busy = space.repo.Branch, space.busy
		space.mu.Unlock()
	}
	state = s.sleepState(r.Context(), id, state)
	if busy && state == "ready" {
		state = "busy"
	}
	writeJSON(w, 200, map[string]any{"id": id, "state": state, "branch": branch, "preview": s.previewJSON(id)})
	return nil
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request, id string) error {
	if err := s.remove(r.Context(), id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func readJSON(r *http.Request, limit int64, into any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return problem(400, "The request couldn't be read.")
	}
	if int64(len(body)) > limit {
		return problem(413, "That request is too large.")
	}
	if err := json.Unmarshal(body, into); err != nil {
		return problem(400, "The request isn't valid JSON.")
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
