package sandbox

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

/*
 * Web search for kimono-search: the gateway runs the Tavily Pro Tool through
 * the person's own Composio session (the one the agent's tools use, so it is
 * paid from their Pro Tools like any other), every query at once in one
 * COMPOSIO_MULTI_EXECUTE_TOOL call. Claude Code's own WebSearch is a model call
 * of its own and takes five to seven seconds a query; three of these come back
 * in under two, so the agent can look several things up and still start
 * writing quickly.
 *
 *   POST /search  {"queries": ["…", …], "news": false, "days": 0}
 *   → {"results": [{"query": "…", "results": [{"title", "url", "content"}], "error"?: "…"}]}
 */

const maxSearchQueries = 8

var searchClient = &http.Client{Timeout: 30 * time.Second}

type searchRequest struct {
	Queries []string `json:"queries"`
	News    bool     `json:"news"`
	Days    int      `json:"days"`
}

type searchHit struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Content string `json:"content"`
}

type searchAnswer struct {
	Query   string      `json:"query"`
	Results []searchHit `json:"results"`
	Error   string      `json:"error,omitempty"`
}

func (s *Server) serveSearch(w http.ResponseWriter, r *http.Request) {
	space := s.byToken(bearer(r.Header))
	if space == nil {
		writeError(w, 401, "This sandbox isn't known here.")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, 405, "Ask with POST.")
		return
	}
	space.mu.Lock()
	tools, busy := space.tools, space.busy
	space.mu.Unlock()
	if tools.URL == "" {
		writeError(w, 404, "Quick search isn't here: use WebSearch.")
		return
	}
	if !busy {
		writeError(w, 409, "Searching works only while a turn is running.")
		return
	}
	var request searchRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&request); err != nil {
		writeError(w, 400, "That search can't be read.")
		return
	}
	queries := []string{}
	for _, query := range request.Queries {
		if query = strings.TrimSpace(query); query != "" && len(query) <= 400 {
			queries = append(queries, query)
		}
	}
	if len(queries) == 0 {
		writeError(w, 400, "Say what to search for.")
		return
	}
	if len(queries) > maxSearchQueries {
		queries = queries[:maxSearchQueries]
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	answers, err := s.searchTools(ctx, space, tools, queries, request.News, request.Days)
	if err != nil {
		writeError(w, 502, "Quick search didn't work ("+err.Error()+"): use WebSearch.")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"results": answers})
}

// searchTools runs every query as TAVILY_SEARCH in one multi-execute call.
func (s *Server) searchTools(ctx context.Context, space *workspace, tools ToolsAuth, queries []string, news bool, days int) ([]searchAnswer, error) {
	items := make([]map[string]any, len(queries))
	for i, query := range queries {
		arguments := map[string]any{"query": query, "max_results": 5, "search_depth": "basic"}
		if news {
			arguments["topic"] = "news"
			if days > 0 {
				arguments["days"] = days
			}
		}
		items[i] = map[string]any{"tool_slug": "TAVILY_SEARCH", "arguments": arguments}
	}
	call := map[string]any{"name": "COMPOSIO_MULTI_EXECUTE_TOOL", "arguments": map[string]any{"tools": items, "sync_response_to_workbench": false, "thought": "Looking these up on the web."}}
	result, err := s.toolsCall(ctx, space, tools, call)
	if err != nil {
		return nil, err
	}
	var outer struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		IsError bool `json:"isError"`
	}
	if err := json.Unmarshal(result, &outer); err != nil || len(outer.Content) == 0 {
		return nil, fmt.Errorf("its answer couldn't be read")
	}
	var done struct {
		Successful bool   `json:"successful"`
		Error      string `json:"error"`
		Data       struct {
			Results []struct {
				Response struct {
					Successful bool   `json:"successful"`
					Error      string `json:"error"`
					Data       struct {
						Results []searchHit `json:"results"`
					} `json:"data"`
				} `json:"response"`
			} `json:"results"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(outer.Content[0].Text), &done); err != nil {
		return nil, fmt.Errorf("its answer couldn't be read")
	}
	if outer.IsError || (!done.Successful && len(done.Data.Results) == 0) {
		if done.Error != "" {
			return nil, fmt.Errorf("%s", firstLine(done.Error))
		}
		return nil, fmt.Errorf("Pro Tools said no")
	}
	answers := make([]searchAnswer, len(queries))
	for i, query := range queries {
		answers[i] = searchAnswer{Query: query, Results: []searchHit{}}
		if i >= len(done.Data.Results) {
			answers[i].Error = "no answer"
			continue
		}
		response := done.Data.Results[i].Response
		if !response.Successful && len(response.Data.Results) == 0 {
			answers[i].Error = firstLine(response.Error)
			if answers[i].Error == "" {
				answers[i].Error = "the search failed"
			}
			continue
		}
		answers[i].Results = response.Data.Results
	}
	return answers, nil
}

func firstLine(text string) string {
	text, _, _ = strings.Cut(strings.TrimSpace(text), "\n")
	if len(text) > 200 {
		text = text[:200]
	}
	return text
}

/* ── the person's tool session, as an MCP client of our own ── */

type mcpSession struct {
	mu  sync.Mutex
	url string
	id  string
}

var mcpSessions sync.Map // workspace id → *mcpSession

// toolsCall makes one tools/call on the person's tool session, opening an MCP
// session there first (kept per workspace, and opened again when it lapses).
func (s *Server) toolsCall(ctx context.Context, space *workspace, tools ToolsAuth, params map[string]any) (json.RawMessage, error) {
	value, _ := mcpSessions.LoadOrStore(space.id, &mcpSession{})
	session := value.(*mcpSession)
	session.mu.Lock()
	defer session.mu.Unlock()
	for attempt := 0; attempt < 2; attempt++ {
		if session.id == "" || session.url != tools.URL {
			session.url, session.id = tools.URL, ""
			if _, err := mcpPost(ctx, session, tools, "initialize", map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "kimono-search", "version": "1"}}); err != nil {
				return nil, err
			}
			_, _ = mcpPost(ctx, session, tools, "notifications/initialized", nil)
		}
		result, err := mcpPost(ctx, session, tools, "tools/call", params)
		if err == errMCPSessionGone {
			session.id = ""
			continue
		}
		return result, err
	}
	return nil, fmt.Errorf("the tools session kept closing")
}

var errMCPSessionGone = fmt.Errorf("the tools session closed")

var mcpIDs atomic.Int64

func mcpPost(ctx context.Context, session *mcpSession, tools ToolsAuth, method string, params map[string]any) (json.RawMessage, error) {
	message := map[string]any{"jsonrpc": "2.0", "method": method}
	notification := strings.HasPrefix(method, "notifications/")
	if !notification {
		/* A small number: Composio refuses an id as large as a nanosecond clock. */
		message["id"] = mcpIDs.Add(1)
	}
	if params != nil {
		message["params"] = params
	}
	body, _ := json.Marshal(message)
	request, _ := http.NewRequestWithContext(ctx, "POST", tools.URL, bytes.NewReader(body))
	for name, value := range tools.Headers {
		request.Header.Set(name, value)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if session.id != "" {
		request.Header.Set("Mcp-Session-Id", session.id)
	}
	response, err := searchClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("Composio didn't answer")
	}
	defer response.Body.Close()
	if id := response.Header.Get("Mcp-Session-Id"); id != "" {
		session.id = id
	}
	if response.StatusCode == 404 && session.id != "" && method != "initialize" {
		return nil, errMCPSessionGone
	}
	if response.StatusCode >= 300 {
		return nil, fmt.Errorf("Composio said %s", response.Status)
	}
	if notification {
		return nil, nil
	}
	/* The answer comes as JSON or as one server-sent event. */
	raw, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("Composio's answer was cut short")
	}
	if strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		scanner := bufio.NewScanner(bytes.NewReader(raw))
		scanner.Buffer(make([]byte, 0, 64<<10), 8<<20)
		var data []byte
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "data:") {
				data = []byte(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
			}
		}
		raw = data
	}
	var answer struct {
		Result json.RawMessage `json:"result"`
		Error  *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &answer); err != nil {
		return nil, fmt.Errorf("Composio's answer couldn't be read")
	}
	if answer.Error != nil {
		return nil, fmt.Errorf("%s", firstLine(answer.Error.Message))
	}
	return answer.Result, nil
}
