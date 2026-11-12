package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

/*
 * Web search for kimono-search: the gateway asks Tavily, every query at once,
 * with the key the Portal gave (the sandbox never sees it). Claude Code's own
 * WebSearch is a model call of its own and takes five to seven seconds a
 * query; this answers in about one, so the agent can look up several things
 * and still start writing quickly.
 *
 *   POST /search  {"queries": ["…", …], "news": false, "days": 0}
 *   → {"results": [{"query": "…", "results": [{"title", "url", "content"}], "error"?: "…"}]}
 */

// SearchAuth is the search provider's key (Tavily's), when the Portal has one.
type SearchAuth struct {
	Key string `json:"key"`
}

var searchUpstream = "https://api.tavily.com/search"

var searchClient = &http.Client{Timeout: 20 * time.Second}

const maxSearchQueries = 8

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
	key, busy := space.search.Key, space.busy
	space.mu.Unlock()
	if key == "" {
		writeError(w, 404, "Web search isn't set up here: use WebSearch.")
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
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	answers := make([]searchAnswer, len(queries))
	var wait sync.WaitGroup
	for i, query := range queries {
		wait.Add(1)
		go func() {
			defer wait.Done()
			answers[i] = tavily(ctx, key, query, request.News, request.Days)
		}()
	}
	wait.Wait()
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{"results": answers})
}

func tavily(ctx context.Context, key, query string, news bool, days int) searchAnswer {
	answer := searchAnswer{Query: query, Results: []searchHit{}}
	body := map[string]any{"query": query, "search_depth": "basic", "max_results": 6}
	if news {
		body["topic"] = "news"
		if days > 0 {
			body["days"] = days
		}
	}
	payload, _ := json.Marshal(body)
	request, _ := http.NewRequestWithContext(ctx, "POST", searchUpstream, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := searchClient.Do(request)
	if err != nil {
		answer.Error = "the search didn't answer"
		return answer
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		answer.Error = "the search said " + response.Status
		return answer
	}
	var found struct {
		Results []searchHit `json:"results"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&found); err != nil {
		answer.Error = "the search's answer couldn't be read"
		return answer
	}
	answer.Results = found.Results
	return answer
}
