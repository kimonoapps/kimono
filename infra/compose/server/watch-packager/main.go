// Command kimono-watch-packager turns Kimono Watch streams into HLS for
// browsers, AirPlay and Chromecast. It runs beside the Portal, is never
// published, and only answers the Portal (a shared key). Its input is the
// Portal's own stream relay, so debrid services still only see the server
// and nzbdav's logins stay in the Portal.
//
// The Portal decides everything about a stream (copy or transcode, the
// ladder, the ffmpeg arguments, where segments start) from what /probe
// reports; the packager runs ffmpeg around wherever the viewer is
// (./session.go) and serves the segments.
package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

var (
	ffmpegPath  = env("KIMONO_PACKAGER_FFMPEG", "/usr/lib/jellyfin-ffmpeg/ffmpeg")
	ffprobePath = env("KIMONO_PACKAGER_FFPROBE", "/usr/lib/jellyfin-ffmpeg/ffprobe")
	key         = os.Getenv("KIMONO_PACKAGER_KEY")
)

func env(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

func main() {
	if key == "" {
		log.Fatal("KIMONO_PACKAGER_KEY is required")
	}
	sessions.root = env("KIMONO_PACKAGER_WORK", filepath.Join(os.TempDir(), "kimono-packager"))
	_ = os.RemoveAll(sessions.root)
	if err := os.MkdirAll(sessions.root, 0o700); err != nil {
		log.Fatal(err)
	}
	startInputProxy()
	go detectHardware()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /probe", authorized(handleProbe))
	mux.HandleFunc("POST /chapters", authorized(handleChapters))
	mux.HandleFunc("POST /fingerprint", authorized(handleFingerprint))
	mux.HandleFunc("POST /ending", authorized(handleEnding))
	mux.HandleFunc("PUT /sessions/{id}", authorized(handlePut))
	mux.HandleFunc("DELETE /sessions/{id}", authorized(func(w http.ResponseWriter, r *http.Request) {
		sessions.remove(r.PathValue("id"))
		w.WriteHeader(http.StatusNoContent)
	}))
	mux.HandleFunc("GET /sessions/{id}/{output}/{file}", authorized(handleFile))
	mux.HandleFunc("HEAD /sessions/{id}/{output}/{file}", authorized(handleFile))

	addr := env("KIMONO_PACKAGER_ADDR", ":8080")
	log.Printf("packager listening on %s", addr)
	server := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(server.ListenAndServe())
}

func authorized(next http.HandlerFunc) http.HandlerFunc {
	want := []byte("Bearer " + key)
	return func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("authorization")), want) != 1 {
			http.Error(w, "not allowed", http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

var sessionID = regexp.MustCompile(`^[a-f0-9]{16,64}$`)

func handlePut(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !sessionID.MatchString(id) {
		http.Error(w, "bad id", http.StatusBadRequest)
		return
	}
	var spec Spec
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<20)).Decode(&spec); err != nil {
		http.Error(w, "bad spec", http.StatusBadRequest)
		return
	}
	if err := sessions.put(id, spec); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

var segmentFile = regexp.MustCompile(`^(\d{1,6})\.(m4s|vtt)$`)

func handleFile(w http.ResponseWriter, r *http.Request) {
	s := sessions.get(r.PathValue("id"))
	if s == nil {
		w.Header().Set("x-kimono-packager", "no-session")
		http.Error(w, "no such session", http.StatusNotFound)
		return
	}
	output, ok := s.output(r.PathValue("output"))
	file := r.PathValue("file")
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("cache-control", "private, max-age=3600")
	if file == "init.mp4" && output.Kind == "fmp4" {
		path, err := s.Init(r.Context(), output.Name)
		serveFile(w, r, path, "video/mp4", err)
		return
	}
	m := segmentFile.FindStringSubmatch(file)
	if m == nil {
		http.NotFound(w, r)
		return
	}
	k, _ := strconv.Atoi(m[1])
	switch {
	case m[2] == "m4s" && output.Kind == "fmp4":
		if r.Header.Get("range") != "" || r.Method == http.MethodHead {
			path, err := s.Segment(r.Context(), output.Name, k)
			serveFile(w, r, path, "video/mp4", err)
			return
		}
		/* Answer at once and send the segment when it is made: players time out
		   waiting for a first byte (hls.js after ten seconds), not for the rest. */
		done := make(chan struct{})
		var path string
		var err error
		go func() { path, err = s.Segment(r.Context(), output.Name, k); close(done) }()
		select {
		case <-done:
			serveFile(w, r, path, "video/mp4", err)
			return
		case <-time.After(2 * time.Second):
		}
		w.Header().Set("content-type", "video/mp4")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-done
		if err != nil {
			panic(http.ErrAbortHandler) // cut the body short so the player retries
		}
		if f, openErr := os.Open(path); openErr == nil {
			_, _ = io.Copy(w, f)
			f.Close()
		} else {
			panic(http.ErrAbortHandler)
		}
	case m[2] == "vtt" && output.Kind == "vtt":
		var body []byte
		var err error
		done := make(chan struct{})
		go func() { body, err = s.Subtitles(r.Context(), output.Name, k); close(done) }()
		select {
		case <-done:
			if err != nil {
				problem(w, err)
				return
			}
			w.Header().Set("content-type", "text/vtt; charset=utf-8")
			http.ServeContent(w, r, file, time.Time{}, strings.NewReader(string(body)))
		case <-time.After(2 * time.Second):
			w.Header().Set("content-type", "text/vtt; charset=utf-8")
			w.WriteHeader(http.StatusOK)
			w.(http.Flusher).Flush()
			<-done
			if err != nil {
				panic(http.ErrAbortHandler)
			}
			_, _ = w.Write(body)
		}
	default:
		http.NotFound(w, r)
	}
}

func problem(w http.ResponseWriter, err error) {
	if errors.Is(err, errGone) {
		http.Error(w, err.Error(), http.StatusNotFound)
		return
	}
	http.Error(w, err.Error(), http.StatusServiceUnavailable)
}

func serveFile(w http.ResponseWriter, r *http.Request, path, kind string, err error) {
	if err != nil {
		problem(w, err)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		problem(w, errGone)
		return
	}
	defer f.Close()
	w.Header().Set("content-type", kind)
	http.ServeContent(w, r, "", time.Time{}, f)
}

/* ───── Probe ───── */

type probeResult struct {
	Format    json.RawMessage `json:"format"`
	Streams   json.RawMessage `json:"streams"`
	Keyframes []float64       `json:"keyframes"`
	Hardware  hardware        `json:"hardware"`
}

var probes = struct {
	sync.Mutex
	known map[string]probeEntry
}{known: map[string]probeEntry{}}

type probeEntry struct {
	at     time.Time
	result *probeResult
}

func handleProbe(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Input string `json:"input"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); err != nil || !strings.HasPrefix(body.Input, "http") {
		http.Error(w, "bad input", http.StatusBadRequest)
		return
	}
	probes.Lock()
	for k, v := range probes.known {
		if time.Since(v.at) > 6*time.Hour {
			delete(probes.known, k)
		}
	}
	known := probes.known[body.Input]
	probes.Unlock()
	if known.result != nil {
		writeJSON(w, http.StatusOK, known.result)
		return
	}
	result, err := probe(r.Context(), body.Input)
	if err != nil {
		log.Printf("probe failed: %v", err)
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	probes.Lock()
	probes.known[body.Input] = probeEntry{at: time.Now(), result: result}
	probes.Unlock()
	writeJSON(w, http.StatusOK, result)
}

func probe(ctx context.Context, remote string) (*probeResult, error) {
	input := localInput(remote)
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	type answer struct {
		frames []float64
		err    error
	}
	keyframes := make(chan answer, 1)
	go func() {
		frames, err := matroskaKeyframes(rangeFetcher(ctx, input))
		keyframes <- answer{frames, err}
	}()
	cmd := exec.CommandContext(ctx, ffprobePath, "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
		"-analyzeduration", "10M", "-probesize", "10M", input)
	errs := &tail{}
	cmd.Stderr = errs
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe couldn't read it: %v %s", err, lastLine(errs.String()))
	}
	var parsed struct {
		Format  json.RawMessage `json:"format"`
		Streams json.RawMessage `json:"streams"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return nil, err
	}
	k := <-keyframes
	if k.err != nil {
		log.Printf("probe: no keyframe index (%v); copied streams will be transcoded instead", k.err)
	}
	return &probeResult{Format: parsed.Format, Streams: parsed.Streams, Keyframes: k.frames, Hardware: currentHardware()}, nil
}

func rangeFetcher(ctx context.Context, url string) fetcher {
	client := &http.Client{Timeout: 30 * time.Second}
	return func(off, n int64) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("range", fmt.Sprintf("bytes=%d-%d", off, off+n-1))
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusPartialContent {
			return nil, fmt.Errorf("range request answered %d", resp.StatusCode)
		}
		return io.ReadAll(io.LimitReader(resp.Body, n))
	}
}
