package main

// ffmpeg reads a stream through a loopback proxy that keeps the file's first
// and last few megabytes. Opening a Matroska file reads the head, jumps to
// the Cues at the end and back, then seeks: six requests through the relay
// to the debrid service or nzbdav, about a second each. With the ends kept
// here, only the read of the picture itself goes upstream, so starting and
// seeking cost one request instead of six.

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	/* Past ffmpeg's probe (5 MB): every encoder restart probes the file again, and
	   one with bitmap or ASS subtitles (most films) reads all of it. */
	headBytes = 6 << 20
	tailBytes = 2 << 20
	maxInputs = 16
)

type region struct {
	start int64
	data  []byte
}

type cachedInput struct {
	url     string
	mu      sync.Mutex
	loaded  bool
	size    int64
	regions []region
	used    time.Time
}

var inputs = struct {
	sync.Mutex
	all  map[string]*cachedInput
	addr string
}{all: map[string]*cachedInput{}}

var upstream = &http.Client{Timeout: 0, Transport: &http.Transport{ResponseHeaderTimeout: 45 * time.Second, MaxIdleConnsPerHost: 8}}

// localInput is the loopback address ffmpeg reads url through.
func localInput(url string) string {
	sum := sha256.Sum256([]byte(url))
	id := hex.EncodeToString(sum[:16])
	inputs.Lock()
	defer inputs.Unlock()
	if in, ok := inputs.all[id]; ok {
		in.used = time.Now()
	} else {
		if len(inputs.all) >= maxInputs {
			var oldest string
			for k, v := range inputs.all {
				if oldest == "" || v.used.Before(inputs.all[oldest].used) {
					oldest = k
				}
			}
			delete(inputs.all, oldest)
		}
		inputs.all[id] = &cachedInput{url: url, used: time.Now()}
	}
	return "http://" + inputs.addr + "/input/" + id
}

func fetchRange(url string, from, to int64) ([]byte, int64, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("range", fmt.Sprintf("bytes=%d-%d", from, to))
	resp, err := upstream.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent {
		return nil, 0, &statusError{resp.StatusCode}
	}
	size := totalOf(resp.Header.Get("content-range"))
	data, err := io.ReadAll(io.LimitReader(resp.Body, to-from+1))
	return data, size, err
}

var contentRange = regexp.MustCompile(`/(\d+)$`)

func totalOf(header string) int64 {
	m := contentRange.FindStringSubmatch(header)
	if m == nil {
		return -1
	}
	n, _ := strconv.ParseInt(m[1], 10, 64)
	return n
}

// load fetches the file's two ends, head then tail. A failure isn't
// kept: a source slow to answer the first time is asked again next time.
func (in *cachedInput) load() error {
	in.mu.Lock()
	defer in.mu.Unlock()
	if in.loaded {
		return nil
	}
	type part struct {
		data []byte
		size int64
		err  error
	}
	head := make(chan part, 1)
	go func() {
		data, size, err := fetchRange(in.url, 0, headBytes-1)
		head <- part{data, size, err}
	}()
	/* The tail needs the size; a guess from the first answer's would cost a round trip, so it waits for the head. */
	h := <-head
	if h.err != nil {
		return h.err
	}
	if h.size <= 0 {
		return errors.New("the stream didn't say how big it is")
	}
	in.size = h.size
	in.regions = []region{{0, h.data}}
	if start := max(int64(len(h.data)), h.size-tailBytes); start < h.size {
		if tail, _, err := fetchRange(in.url, start, h.size-1); err == nil {
			in.regions = append(in.regions, region{start, tail})
		}
	}
	in.loaded = true
	return nil
}

// inputOf is the cached input behind a loopback address, if any.
func inputOf(local string) *cachedInput {
	id := local[strings.LastIndex(local, "/")+1:]
	inputs.Lock()
	defer inputs.Unlock()
	return inputs.all[id]
}

// statusError is an upstream answer that wasn't the bytes asked for.
type statusError struct{ status int }

func (e *statusError) Error() string { return fmt.Sprintf("the stream answered %d", e.status) }

func (in *cachedInput) cached(at int64) []byte {
	for _, r := range in.regions {
		if at >= r.start && at < r.start+int64(len(r.data)) {
			return r.data[at-r.start:]
		}
	}
	return nil
}

var byteRange = regexp.MustCompile(`^bytes=(\d+)-(\d*)$`)

func serveInput(w http.ResponseWriter, r *http.Request) {
	inputs.Lock()
	in := inputs.all[r.PathValue("id")]
	inputs.Unlock()
	if in == nil {
		http.NotFound(w, r)
		return
	}
	if err := in.load(); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	from, to := int64(0), in.size-1
	if m := byteRange.FindStringSubmatch(r.Header.Get("range")); m != nil {
		from, _ = strconv.ParseInt(m[1], 10, 64)
		if m[2] != "" {
			to, _ = strconv.ParseInt(m[2], 10, 64)
		}
	}
	to = min(to, in.size-1)
	if from > to {
		w.Header().Set("content-range", fmt.Sprintf("bytes */%d", in.size))
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	w.Header().Set("accept-ranges", "bytes")
	w.Header().Set("content-type", "application/octet-stream")
	w.Header().Set("content-length", strconv.FormatInt(to-from+1, 10))
	w.Header().Set("content-range", fmt.Sprintf("bytes %d-%d/%d", from, to, in.size))
	w.WriteHeader(http.StatusPartialContent)
	if r.Method == http.MethodHead {
		return
	}
	at := from
	tries := 0
	for at <= to {
		if data := in.cached(at); data != nil {
			n := min(int64(len(data)), to-at+1)
			if _, err := w.Write(data[:n]); err != nil {
				return
			}
			at += n
			continue
		}
		/* Upstream until the next kept region, or the end. */
		stop := to
		for _, reg := range in.regions {
			if reg.start > at && reg.start-1 < stop {
				stop = reg.start - 1
			}
		}
		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, in.url, nil)
		if err != nil {
			return
		}
		req.Header.Set("range", fmt.Sprintf("bytes=%d-%d", at, stop))
		resp, err := upstream.Do(req)
		if err == nil && resp.StatusCode != http.StatusPartialContent {
			resp.Body.Close()
			err = &statusError{resp.StatusCode}
		}
		if err != nil {
			/* A dropped or refused read is asked again, twice, before ffmpeg sees the stream end. */
			if tries++; tries > 2 || r.Context().Err() != nil {
				return
			}
			time.Sleep(time.Duration(tries) * time.Second)
			continue
		}
		n, err := io.Copy(w, io.LimitReader(resp.Body, stop-at+1))
		resp.Body.Close()
		at += n
		if err != nil && r.Context().Err() != nil {
			return
		}
		if n > 0 {
			tries = 0
		} else if tries++; tries > 2 {
			return
		}
	}
}

// startInputProxy listens on loopback for ffmpeg.
func startInputProxy() {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal(err)
	}
	inputs.addr = listener.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /input/{id}", serveInput)
	mux.HandleFunc("HEAD /input/{id}", serveInput)
	go func() { log.Fatal(http.Serve(listener, mux)) }()
}
