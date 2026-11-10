package sandbox

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

/*
 * The Quran and hadith for kimono-quran and kimono-hadith: a sandbox can't
 * reach the web, so the gateway fetches from these sources alone, read only.
 * Kimono AI reads a passage with them before it cites it, so it knows exactly
 * what the chat will show (the Portal's scripture cards use the same sources).
 *
 *   /scripture/quran/<path>   api.quran.com/api/v4/<path>
 *   /scripture/hadith/<path>  fawazahmed0/hadith-api editions/<path>, from
 *                             jsDelivr or, when it won't serve one, GitHub
 */

var scriptureSources = map[string][]string{
	"quran":  {"https://api.quran.com/api/v4/"},
	"hadith": {"https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/", "https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/"},
}

var scripturePath = regexp.MustCompile(`^[A-Za-z0-9_:.,-]+(/[A-Za-z0-9_:.,-]+)*$`)

const scriptureLimit = 8 << 20

var scriptureClient = &http.Client{Timeout: 20 * time.Second}

func (s *Server) serveScripture(w http.ResponseWriter, r *http.Request) {
	if s.byToken(bearer(r.Header)) == nil {
		writeError(w, 401, "This sandbox isn't known here.")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, 405, "Only reading.")
		return
	}
	kind, rest, _ := strings.Cut(strings.TrimPrefix(r.URL.Path, "/scripture/"), "/")
	bases, ok := scriptureSources[kind]
	if !ok || !scripturePath.MatchString(rest) || strings.Contains(rest, "..") {
		writeError(w, 404, "No such source.")
		return
	}
	query := ""
	if kind == "quran" && r.URL.RawQuery != "" {
		values, err := url.ParseQuery(r.URL.RawQuery)
		if err != nil {
			writeError(w, 400, "That query can't be read.")
			return
		}
		query = "?" + values.Encode()
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	status := 502
	for _, base := range bases {
		request, _ := http.NewRequestWithContext(ctx, "GET", base+rest+query, nil)
		request.Header.Set("Accept", "application/json")
		request.Header.Set("User-Agent", "kimono-node")
		response, err := scriptureClient.Do(request)
		if err != nil {
			continue
		}
		if response.StatusCode != 200 {
			status = response.StatusCode
			response.Body.Close()
			continue
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, _ = io.Copy(w, io.LimitReader(response.Body, scriptureLimit))
		response.Body.Close()
		return
	}
	if status == 404 || status == 403 {
		writeError(w, 404, "Not found there.")
		return
	}
	writeError(w, 502, "The source couldn't be reached.")
}
