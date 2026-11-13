package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const realDebridAPI = "https://api.real-debrid.com/rest/1.0"

// debridKey asks the Portal for Watch's Real-Debrid key (apps/portal
// src/app/api/books/debrid). It is read fresh each time, so a key changed in
// Applications → Watch is picked up without restarting.
func debridKey(ctx context.Context, cfg config) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.PortalURL+"/api/books/debrid", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.Key)
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return "", errors.New("Watch has no Real-Debrid account; add one in Applications → Watch")
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Portal: %s", res.Status)
	}
	var body struct {
		Key string `json:"key"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil || body.Key == "" {
		return "", errors.New("Portal gave no Real-Debrid key")
	}
	return body.Key, nil
}

type realDebrid struct{ key string }

func (rd realDebrid) call(ctx context.Context, method, path string, form url.Values, into any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, realDebridAPI+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+rd.key)
	req.Header.Set("User-Agent", userAgent)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("Real-Debrid %s: %s %s", path, res.Status, strings.TrimSpace(string(msg)))
	}
	if into == nil || res.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(into)
}

type rdTorrent struct {
	ID       string   `json:"id"`
	Hash     string   `json:"hash"`
	Status   string   `json:"status"`
	Progress float64  `json:"progress"`
	Links    []string `json:"links"`
}

// torrentFiles gets a torrent onto Real-Debrid and returns its files as
// plain downloads. A torrent already on the account is reused, so a fetch
// interrupted mid-way carries on where it was.
func (rd realDebrid) torrentFiles(ctx context.Context, magnet, btih string, status *status, label string) ([]remoteDump, error) {
	id, err := rd.find(ctx, btih)
	if err != nil {
		return nil, err
	}
	if id == "" {
		var added struct {
			ID string `json:"id"`
		}
		if err := rd.call(ctx, http.MethodPost, "/torrents/addMagnet", url.Values{"magnet": {magnet}}, &added); err != nil {
			return nil, err
		}
		id = added.ID
	}
	for {
		var t rdTorrent
		if err := rd.call(ctx, http.MethodGet, "/torrents/info/"+id, nil, &t); err != nil {
			return nil, err
		}
		switch t.Status {
		case "waiting_files_selection":
			if err := rd.call(ctx, http.MethodPost, "/torrents/selectFiles/"+id, url.Values{"files": {"all"}}, nil); err != nil {
				return nil, err
			}
			continue
		case "downloaded":
			return rd.unrestrict(ctx, t.Links)
		case "magnet_error", "error", "virus", "dead":
			return nil, fmt.Errorf("Real-Debrid could not get %s: %s", label, t.Status)
		}
		status.set("Real-Debrid is fetching "+label, int64(t.Progress), 100)
		select {
		case <-time.After(time.Minute):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}

func (rd realDebrid) find(ctx context.Context, btih string) (string, error) {
	for page := 1; page <= 20; page++ {
		var list []rdTorrent
		if err := rd.call(ctx, http.MethodGet, fmt.Sprintf("/torrents?limit=100&page=%d", page), nil, &list); err != nil {
			return "", err
		}
		for _, t := range list {
			if strings.EqualFold(t.Hash, btih) {
				return t.ID, nil
			}
		}
		if len(list) < 100 {
			break
		}
	}
	return "", nil
}

func (rd realDebrid) unrestrict(ctx context.Context, links []string) ([]remoteDump, error) {
	var out []remoteDump
	for _, link := range links {
		var u struct {
			Download string `json:"download"`
			Filename string `json:"filename"`
			Filesize int64  `json:"filesize"`
		}
		if err := rd.call(ctx, http.MethodPost, "/unrestrict/link", url.Values{"link": {link}}, &u); err != nil {
			return nil, err
		}
		name := strings.ReplaceAll(u.Filename, string(os.PathSeparator), "_")
		out = append(out, remoteDump{URL: u.Download, Name: name, Size: u.Filesize})
	}
	return out, nil
}
