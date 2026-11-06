package sandbox

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
)

/*
 * Media the person's tools made (a voice, a video, a picture) comes back from
 * them as a link, and the sandbox has no web to follow it. The gateway notes
 * every https link in a workspace's tool results as they pass, and /media
 * fetches one of those, only those, and only when it is a picture, a sound or
 * a video: kimono-fetch brings it in. Anything else stays out, as before.
 */

const (
	mediaMaxBytes   = 200 << 20
	mediaRemembered = 300
	mediaKeep       = 3 * time.Hour
	// linkTail is how much of a stream is kept between reads, so a link split
	// across two reads is still seen whole.
	linkTail = 4096
)

var linkPattern = regexp.MustCompile(`https://[^\s"'<>]+`)

var linkUnescape = strings.NewReplacer(`\\u0026`, "&", `&`, "&", `\\u003d`, "=", `=`, "=", `\\/`, "/", `\/`, "/")

// cleanLink undoes the JSON escaping a link picks up inside a tool result
// (often twice: the result is JSON inside the MCP message's JSON).
func cleanLink(raw string) string {
	link := linkUnescape.Replace(raw)
	if i := strings.IndexByte(link, '\\'); i >= 0 {
		link = link[:i]
	}
	return strings.TrimRight(link, ".,;:)]}")
}

// rememberLinks notes the https links in part of a tool result.
func (w *workspace) rememberLinks(text []byte, now time.Time) {
	found := linkPattern.FindAll(text, -1)
	if len(found) == 0 {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.links == nil {
		w.links = map[string]time.Time{}
	}
	for _, raw := range found {
		if link := cleanLink(string(raw)); len(link) > len("https://") && len(link) <= 4096 {
			w.links[link] = now
		}
	}
	if len(w.links) > mediaRemembered {
		for link, at := range w.links {
			if now.Sub(at) > mediaKeep || len(w.links) > mediaRemembered {
				delete(w.links, link)
			}
		}
	}
}

func (w *workspace) knowsLink(link string, now time.Time) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	at, ok := w.links[link]
	return ok && now.Sub(at) <= mediaKeep
}

// linkScanner reads a tool result through to the sandbox, noting its links on the way.
type linkScanner struct {
	io.ReadCloser
	space *workspace
	now   func() time.Time
	tail  []byte
}

func (l *linkScanner) Read(p []byte) (int, error) {
	n, err := l.ReadCloser.Read(p)
	if n > 0 {
		chunk := append(l.tail, p[:n]...)
		l.space.rememberLinks(chunk, l.now())
		if len(chunk) > linkTail {
			chunk = chunk[len(chunk)-linkTail:]
		}
		l.tail = append(l.tail[:0:0], chunk...)
	}
	return n, err
}

var mediaExtensions = map[string]bool{
	".mp3": true, ".wav": true, ".ogg": true, ".oga": true, ".opus": true, ".m4a": true, ".aac": true, ".flac": true,
	".mp4": true, ".m4v": true, ".mov": true, ".webm": true, ".mkv": true,
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true, ".avif": true, ".heic": true,
}

// isMedia says whether a fetched file is a picture, a sound or a video: by its
// type, or by its name when the store only says it's bytes.
func isMedia(contentType, name string) bool {
	kind := strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	switch {
	case kind == "image/svg+xml":
		return false
	case strings.HasPrefix(kind, "audio/"), strings.HasPrefix(kind, "video/"), strings.HasPrefix(kind, "image/"):
		return true
	case kind == "" || kind == "application/octet-stream" || kind == "binary/octet-stream":
		return mediaExtensions[strings.ToLower(path.Ext(name))]
	}
	return false
}

var sharedAddressSpace = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

// publicOnly refuses to connect anywhere but the public internet: a link in
// a tool result can be anyone's, and must not reach this node's own network.
func publicOnly(_, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return err
	}
	ip := net.ParseIP(host)
	if ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || sharedAddressSpace.Contains(ip) {
		return errors.New("not a public address")
	}
	return nil
}

func newMediaClient() *http.Client {
	dialer := &net.Dialer{Timeout: 20 * time.Second, Control: publicOnly}
	return &http.Client{
		Transport: &http.Transport{Proxy: nil, DialContext: dialer.DialContext, TLSHandshakeTimeout: 20 * time.Second, ResponseHeaderTimeout: 2 * time.Minute},
		CheckRedirect: func(next *http.Request, via []*http.Request) error {
			if next.URL.Scheme != "https" || len(via) >= 5 {
				return errors.New("redirected away")
			}
			return nil
		},
	}
}

// serveMedia brings one file a tool linked to into the sandbox (kimono-fetch).
func (s *Server) serveMedia(w http.ResponseWriter, r *http.Request) {
	space := s.byToken(bearer(r.Header))
	if space == nil {
		writeError(w, 401, "This sandbox has no tools.")
		return
	}
	link := r.URL.Query().Get("link")
	target, err := url.Parse(link)
	if err != nil || target.Scheme != "https" || target.Host == "" {
		writeError(w, 400, "Give the https link a tool gave back.")
		return
	}
	if !space.knowsLink(link, s.now()) {
		writeError(w, 403, "That link didn't come from one of your tools in this chat, or it's over three hours old.")
		return
	}
	s.touch(space.id)
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Minute)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, "GET", link, nil)
	request.Header.Set("User-Agent", "kimono-node")
	client := s.mediaClient
	if client == nil {
		client = newMediaClient()
	}
	response, err := client.Do(request)
	if err != nil {
		writeError(w, 502, "The file couldn't be fetched.")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		writeError(w, 502, "The file couldn't be fetched: its link answered "+strconv.Itoa(response.StatusCode)+". It may have expired; run the tool again.")
		return
	}
	name := path.Base(response.Request.URL.Path)
	if !isMedia(response.Header.Get("Content-Type"), name) {
		writeError(w, 415, "That link isn't a picture, a sound or a video.")
		return
	}
	if response.ContentLength > mediaMaxBytes {
		writeError(w, 413, "That file is over 200 MB.")
		return
	}
	w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
	w.Header().Set("X-Kimono-Name", name)
	if response.ContentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(response.ContentLength, 10))
	}
	if copied, _ := io.Copy(w, io.LimitReader(response.Body, mediaMaxBytes+1)); copied > mediaMaxBytes {
		/* Too big after all: break the stream so the helper doesn't keep half a file. */
		panic(http.ErrAbortHandler)
	}
}
