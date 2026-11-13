package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var client = &http.Client{Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: time.Minute}}

var dumpDate = regexp.MustCompile(`\d{4}-\d{2}-\d{2}`)

// remoteDump is where a "latest" link resolves to: archive.org's dated file.
type remoteDump struct {
	URL, Name, Date string
	Size            int64
}

// resolveLatest follows Open Library's "latest" redirect to the dated file.
func resolveLatest(ctx context.Context, kind string) (remoteDump, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, fmt.Sprintf(openLibraryLatest, kind), nil)
	if err != nil {
		return remoteDump{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	res, err := client.Do(req)
	if err != nil {
		return remoteDump{}, err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return remoteDump{}, fmt.Errorf("%s dump: %s", kind, res.Status)
	}
	name := path.Base(res.Request.URL.Path)
	date := dumpDate.FindString(name)
	if date == "" || res.ContentLength <= 0 {
		return remoteDump{}, fmt.Errorf("%s dump: unexpected file %q", kind, name)
	}
	return remoteDump{URL: res.Request.URL.String(), Name: name, Date: date, Size: res.ContentLength}, nil
}

// fetch downloads the dump into dir, picking up a partial download where it
// stopped. A file already complete is kept as it is.
func fetch(ctx context.Context, dump remoteDump, dir string, progress func(done, total int64)) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	final := filepath.Join(dir, dump.Name)
	if info, err := os.Stat(final); err == nil && info.Size() == dump.Size {
		return final, nil
	}
	partial := final + ".part"
	for attempt := 1; ; attempt++ {
		err := fetchOnce(ctx, dump, partial, progress)
		if err == nil {
			break
		}
		if ctx.Err() != nil || attempt == 8 {
			return "", err
		}
		logf("%s: %v; retrying", dump.Name, err)
		select {
		case <-time.After(time.Duration(attempt*attempt) * 10 * time.Second):
		case <-ctx.Done():
			return "", ctx.Err()
		}
	}
	return final, os.Rename(partial, final)
}

func fetchOnce(ctx context.Context, dump remoteDump, partial string, progress func(done, total int64)) error {
	file, err := os.OpenFile(partial, os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	offset, err := file.Seek(0, io.SeekEnd)
	if err != nil {
		return err
	}
	if offset == dump.Size {
		return nil
	}
	if offset > dump.Size {
		offset = 0
		if err := file.Truncate(0); err != nil {
			return err
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, dump.URL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	if offset > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	switch {
	case res.StatusCode == http.StatusPartialContent && strings.HasPrefix(res.Header.Get("Content-Range"), fmt.Sprintf("bytes %d-", offset)):
	case res.StatusCode == http.StatusOK:
		// The server ignored the range: start over.
		if err := file.Truncate(0); err != nil {
			return err
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return err
		}
		offset = 0
	default:
		return fmt.Errorf("download: %s", res.Status)
	}
	done := offset
	buf := make([]byte, 1<<20)
	last := time.Now()
	for {
		n, readErr := res.Body.Read(buf)
		if n > 0 {
			if _, err := file.Write(buf[:n]); err != nil {
				return err
			}
			done += int64(n)
			if progress != nil && time.Since(last) > 2*time.Second {
				progress(done, dump.Size)
				last = time.Now()
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if done != dump.Size {
		return fmt.Errorf("download ended at %d of %d bytes", done, dump.Size)
	}
	return file.Sync()
}

// pruneDumps removes dated dumps other than the ones just imported.
func pruneDumps(dir string, keep map[string]bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !keep[entry.Name()] && strings.HasPrefix(entry.Name(), "ol_dump_") {
			os.Remove(filepath.Join(dir, entry.Name()))
		}
	}
}
