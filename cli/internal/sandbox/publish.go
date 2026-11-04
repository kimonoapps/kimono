package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type publishRequest struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// publishScript commits whatever is uncommitted and pushes the branch. Exit 5
// means there is nothing on the branch that its base doesn't already have.
const publishScript = `set -e
title=$1 base=$2 branch=$3
git add -A
if ! git diff --cached --quiet; then git commit --quiet -m "$title"; fi
[ "$(git rev-list --count "origin/$base..HEAD")" -gt 0 ] || exit 5
git push --quiet origin "HEAD:refs/heads/$branch"`

func (s *Server) handlePublish(w http.ResponseWriter, r *http.Request, id string) error {
	var request publishRequest
	if err := readJSON(r, 256<<10, &request); err != nil {
		return err
	}
	request.Title = strings.TrimSpace(request.Title)
	if request.Title == "" || len(request.Title) > 255 || strings.ContainsAny(request.Title, "\r\n") {
		return problem(400, "Give the pull request a one-line title.")
	}
	space, err := s.remembered(id)
	if err != nil {
		return err
	}
	if _, err := s.running(r.Context(), id); err != nil {
		return err
	}
	space.op.Lock()
	defer space.op.Unlock()
	space.mu.Lock()
	repo, token, base := space.repo, space.git.Token, space.base
	space.mu.Unlock()
	_, err = s.exec(r.Context(), space, nil, nil, "sh", "-c", publishScript, "publish", request.Title, repo.Base, repo.Branch)
	if exitCode(err) == 5 {
		return problem(409, "Nothing to publish yet.")
	}
	if err != nil {
		return fmt.Errorf("push %s: %w", repo.Branch, err)
	}
	if s.cfg.DevGitDir != "" && base == "http://"+DevGitHost {
		writeJSON(w, 200, map[string]any{"url": base + "/" + repo.Owner + "/" + repo.Name + "/compare/" + repo.Base + "..." + repo.Branch, "number": 0})
		return nil
	}
	pull, err := openPull(r.Context(), base, token, repo, request)
	if err != nil {
		return err
	}
	writeJSON(w, 200, pull)
	return nil
}

type pull struct {
	URL    string `json:"url"`
	Number int    `json:"number"`
}

// openPull returns the open pull request for the branch, or opens one.
func openPull(ctx context.Context, base, token string, repo Repo, request publishRequest) (pull, error) {
	api := base + "/api/v1/repos/" + url.PathEscape(repo.Owner) + "/" + url.PathEscape(repo.Name) + "/pulls"
	client := &http.Client{Timeout: 30 * time.Second}
	call := func(method, address string, body any) ([]byte, int, error) {
		var payload io.Reader
		if body != nil {
			encoded, _ := json.Marshal(body)
			payload = bytes.NewReader(encoded)
		}
		req, err := http.NewRequestWithContext(ctx, method, address, payload)
		if err != nil {
			return nil, 0, err
		}
		req.Header.Set("Authorization", "token "+token)
		req.Header.Set("Accept", "application/json")
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := client.Do(req)
		if err != nil {
			return nil, 0, fmt.Errorf("Kimono Git isn't answering: %w", err)
		}
		defer response.Body.Close()
		data, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
		return data, response.StatusCode, err
	}
	type forgejoPull struct {
		Number  int    `json:"number"`
		HTMLURL string `json:"html_url"`
		Head    struct {
			Ref string `json:"ref"`
		} `json:"head"`
	}
	data, status, err := call(http.MethodGet, api+"?state=open&limit=50", nil)
	if err != nil {
		return pull{}, err
	}
	if status == http.StatusOK {
		var open []forgejoPull
		if json.Unmarshal(data, &open) == nil {
			for _, existing := range open {
				if existing.Head.Ref == repo.Branch {
					return pull{URL: existing.HTMLURL, Number: existing.Number}, nil
				}
			}
		}
	}
	data, status, err = call(http.MethodPost, api, map[string]string{"title": request.Title, "body": request.Body, "head": repo.Branch, "base": repo.Base})
	if err != nil {
		return pull{}, err
	}
	if status != http.StatusCreated && status != http.StatusOK {
		var refusal struct {
			Message string `json:"message"`
		}
		_ = json.Unmarshal(data, &refusal)
		if refusal.Message == "" {
			refusal.Message = http.StatusText(status)
		}
		return pull{}, problem(502, "Kimono Git didn't open the pull request: "+refusal.Message)
	}
	var created forgejoPull
	if err := json.Unmarshal(data, &created); err != nil {
		return pull{}, err
	}
	return pull{URL: created.HTMLURL, Number: created.Number}, nil
}
