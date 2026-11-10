package sandbox

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	maxFileBytes = 2 << 20
	// maxSyncBytes is the largest file that goes between Drive and a sandbox.
	// Both ways stream, so the real bound is the sandbox's disk.
	maxSyncBytes = 4 << 30 // the tree scripts below say it as 4294967296
	// bigFileBytes is where a file into a sandbox is first checked against its disk.
	bigFileBytes = 50 << 20
	// keepFreeBytes is left over after a big file goes in, for the agent to work.
	keepFreeBytes      = 256 << 20
	maxTreeFiles       = 5000
	maxAttachmentBytes = 20 << 20
	maxDiffBytes       = 1 << 20
)

// cleanPath turns a path the Portal sends into one relative to the repository
// root, refusing anything that climbs out of it or into .git.
func cleanPath(raw string) (string, bool) {
	if strings.ContainsRune(raw, 0) || strings.HasPrefix(raw, "/") || len(raw) > 4096 {
		return "", false
	}
	for _, segment := range strings.Split(raw, "/") {
		if segment == ".." {
			return "", false
		}
	}
	cleaned := path.Clean(raw)
	if cleaned == "." {
		return "", true
	}
	if first, _, _ := strings.Cut(cleaned, "/"); first == ".git" {
		return "", false
	}
	return cleaned, true
}

var attachmentPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,127}$`)

func validAttachmentName(name string) bool {
	return attachmentPattern.MatchString(name) && !strings.Contains(name, "..")
}

type entry struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Size int64  `json:"size"`
}

// parseListing reads find's `%y\t%s\t%f\0` records, hiding .git.
func parseListing(out []byte) []entry {
	entries := []entry{}
	for _, record := range bytes.Split(out, []byte{0}) {
		fields := strings.SplitN(string(record), "\t", 3)
		if len(fields) != 3 || fields[2] == "" || fields[2] == ".git" {
			continue
		}
		kind := "file"
		switch fields[0] {
		case "d":
			kind = "dir"
		case "l":
			kind = "link"
		}
		size, _ := strconv.ParseInt(fields[1], 10, 64)
		if kind == "dir" {
			size = 0
		}
		entries = append(entries, entry{Name: fields[2], Kind: kind, Size: size})
	}
	sort.Slice(entries, func(i, j int) bool {
		if (entries[i].Kind == "dir") != (entries[j].Kind == "dir") {
			return entries[i].Kind == "dir"
		}
		return strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
	})
	return entries
}

func (s *Server) handleFiles(w http.ResponseWriter, r *http.Request, id string) error {
	dir, ok := cleanPath(r.URL.Query().Get("path"))
	if !ok {
		return problem(400, "That path isn't in this workspace.")
	}
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	target := "./" + dir
	if dir == "" {
		target = "."
	}
	out, err := s.exec(r.Context(), space, nil, nil, "sh", "-c",
		`[ -d "$1" ] || exit 3; find "$1" -mindepth 1 -maxdepth 1 -printf '%y\t%s\t%f\0'`, "files", target)
	if exitCode(err) == 3 {
		return problem(404, "That folder isn't in this workspace.")
	}
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"path": dir, "entries": parseListing(out)})
	return nil
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request, id string) error {
	file, ok := cleanPath(r.URL.Query().Get("path"))
	if !ok || file == "" {
		return problem(400, "That path isn't in this workspace.")
	}
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	/* Viewing caps at 2 MB; copying a file out to Drive (?full=1) at the sync limit, streamed. */
	limit := int64(maxFileBytes)
	if r.URL.Query().Get("full") == "1" {
		limit = maxSyncBytes
	}
	out, err := s.exec(r.Context(), space, nil, nil, "sh", "-c", `[ -f "$1" ] || exit 3; stat -c %s -- "$1"`, "size", "./"+file)
	if exitCode(err) == 3 {
		return problem(404, "That file isn't in this workspace.")
	}
	if err != nil {
		return err
	}
	size, err := strconv.ParseInt(strings.TrimSpace(string(out)), 10, 64)
	if err != nil {
		return err
	}
	if size > limit {
		return problem(413, "That file is too large to show.")
	}
	/* head -c keeps the length promised even if the file grows while it goes. */
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(200)
	if err := s.execStream(r.Context(), space, nil, w, "head", "-c", strconv.FormatInt(size, 10), "--", "./"+file); err != nil {
		/* The status is sent: cutting the body short is how the Portal learns it failed. */
		panic(http.ErrAbortHandler)
	}
	return nil
}

// handlePutFile writes a file into the repository, as Drive hands it back:
// parents made as needed, owned by the agent. It streams, so a big file never
// sits in memory, and goes in under a temporary name so nothing sees half of it.
func (s *Server) handlePutFile(w http.ResponseWriter, r *http.Request, id string) error {
	file, ok := cleanPath(r.URL.Query().Get("path"))
	if !ok || file == "" {
		return problem(400, "That path isn't in this workspace.")
	}
	if r.ContentLength < 0 {
		return problem(411, "Say how long the file is.")
	}
	if r.ContentLength > maxSyncBytes {
		return problem(413, "Files can be at most "+gigabytes(maxSyncBytes)+".")
	}
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	if r.ContentLength > bigFileBytes {
		if room, ok := s.diskRoom(r.Context(), id); ok && r.ContentLength > room-keepFreeBytes {
			writeJSON(w, http.StatusInsufficientStorage, map[string]any{"error": "That file doesn't fit in the sandbox.", "size": r.ContentLength, "room": max(room-keepFreeBytes, 0)})
			return nil
		}
	}
	body := &countingReader{r: io.LimitReader(r.Body, maxSyncBytes+1)}
	err = s.execStream(r.Context(), space, body, io.Discard, "sh", "-c",
		`[ ! -d "$1" ] || exit 3; mkdir -p -- "$(dirname -- "$1")" && part="$1.kimono-part" && cat > "$part" && [ "$(stat -c %s -- "$part")" = "$2" ] && mv -f -- "$part" "$1" || { rm -f -- "$part"; exit 4; }`,
		"put", "./"+file, strconv.FormatInt(r.ContentLength, 10))
	if exitCode(err) == 3 {
		return problem(409, "A folder already has that name.")
	}
	if body.n > maxSyncBytes {
		return problem(413, "Files can be at most "+gigabytes(maxSyncBytes)+".")
	}
	if exitCode(err) == 4 {
		return problem(400, "The file didn't arrive whole.")
	}
	if err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}

// diskRoom is how much more a sandbox may keep, measured now.
func (s *Server) diskRoom(ctx context.Context, id string) (int64, bool) {
	used, err := s.measureDisk(ctx, id)
	if err != nil {
		return 0, false
	}
	return s.limitsNow().diskQuota() - used, true
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

// handleDeleteFile removes one file. Folders are left alone; an empty one is harmless.
func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request, id string) error {
	file, ok := cleanPath(r.URL.Query().Get("path"))
	if !ok || file == "" {
		return problem(400, "That path isn't in this workspace.")
	}
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	_, err = s.exec(r.Context(), space, nil, nil, "sh", "-c", `[ ! -d "$1" ] || exit 3; rm -f -- "$1"`, "delete", "./"+file)
	if exitCode(err) == 3 {
		return problem(409, "That's a folder.")
	}
	if err != nil {
		return err
	}
	w.WriteHeader(204)
	return nil
}

type treeFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
	Sha1 string `json:"sha1"`
}

// parseTree reads `size\tsha1\tpath\0` records, keeping only paths the
// file endpoints would accept, and stops at maxTreeFiles.
func parseTree(out []byte) ([]treeFile, bool) {
	files := []treeFile{}
	for _, record := range bytes.Split(out, []byte{0}) {
		fields := strings.SplitN(string(record), "\t", 3)
		if len(fields) != 3 {
			continue
		}
		clean, ok := cleanPath(fields[2])
		if !ok || clean == "" || clean != fields[2] || len(fields[1]) != 40 {
			continue
		}
		size, err := strconv.ParseInt(fields[0], 10, 64)
		if err != nil || size > maxSyncBytes {
			continue
		}
		if len(files) == maxTreeFiles {
			return files, true
		}
		files = append(files, treeFile{Path: clean, Size: size, Sha1: fields[1]})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, false
}

// treeScript lists every file git would keep (tracked and untracked, not
// ignored), with its size and a sha1 of its bytes. Files over the sync limit
// are listed with an impossible size so they are skipped, not hashed.
const treeScript = `git ls-files -z -co --exclude-standard | xargs -0 -r sh -c '
for f; do
  [ -f "$f" ] && [ ! -L "$f" ] || continue
  n=$(stat -c %s -- "$f")
  if [ "$n" -gt ` + "4294967296" + ` ]; then printf "%s\t%s\t%s\0" "$n" x "$f"; continue; fi
  printf "%s\t%s\t%s\0" "$n" "$(sha1sum -- "$f" | cut -c1-40)" "$f"
done' tree | head -c 4000000`

// grantedScript lists the files a person let the agent use, under
// .kimono/files, the way treeScript lists the task's own (git ignores them).
const grantedScript = `cd .kimono/files 2>/dev/null || exit 0
find . -type f -print0 | sed -z 's|^\./||' | xargs -0 -r sh -c '
for f; do
  [ ! -L "$f" ] || continue
  n=$(stat -c %s -- "$f")
  if [ "$n" -gt ` + "4294967296" + ` ]; then printf "%s\t%s\t%s\0" "$n" x "$f"; continue; fi
  printf "%s\t%s\t%s\0" "$n" "$(sha1sum -- "$f" | cut -c1-40)" "$f"
done' tree | head -c 4000000`

func (s *Server) handleTree(w http.ResponseWriter, r *http.Request, id string) error {
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	script := treeScript
	if r.URL.Query().Get("dir") == "granted" {
		script = grantedScript
	}
	out, err := s.exec(r.Context(), space, nil, nil, "sh", "-c", script)
	if err != nil {
		return err
	}
	/* At the output cap the last record may be cut short: drop it rather than sync half a name. */
	cut := len(out) >= 4000000
	if cut {
		if i := bytes.LastIndexByte(out, 0); i >= 0 {
			out = out[:i]
		}
	}
	files, truncated := parseTree(out)
	truncated = truncated || cut
	writeJSON(w, 200, map[string]any{"files": files, "truncated": truncated})
	return nil
}

func (s *Server) handleAttachment(w http.ResponseWriter, r *http.Request, id string) error {
	name := r.URL.Query().Get("name")
	if !validAttachmentName(name) {
		return problem(400, "That file name isn't one Kimono can use.")
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, maxAttachmentBytes+1))
	if err != nil {
		return problem(400, "The file couldn't be read.")
	}
	if len(body) > maxAttachmentBytes {
		return problem(413, "Attachments can be at most 20 MB.")
	}
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	if _, err := s.exec(r.Context(), space, nil, bytes.NewReader(body), "sh", "-c",
		`mkdir -p /attachments && cat > "/attachments/$1"`, "attach", name); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"path": "/attachments/" + name})
	return nil
}

type changedFile struct {
	Path      string `json:"path"`
	Status    string `json:"status"`
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
}

// parseNameStatus reads `git diff --name-status -z`. A rename or copy carries
// two paths; the file is listed under its new one.
func parseNameStatus(out []byte) []changedFile {
	fields := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
	files := []changedFile{}
	for i := 0; i < len(fields); i++ {
		code := fields[i]
		if code == "" {
			continue
		}
		status := "modified"
		paths := 1
		switch code[0] {
		case 'A':
			status = "added"
		case 'D':
			status = "deleted"
		case 'R':
			status, paths = "renamed", 2
		case 'C':
			status, paths = "added", 2
		}
		if i+paths >= len(fields) {
			break
		}
		files = append(files, changedFile{Path: fields[i+paths], Status: status})
		i += paths
	}
	return files
}

// parseNumstat reads `git diff --numstat -z` into added and deleted lines by
// path. Binary files count as zero.
func parseNumstat(out []byte) map[string][2]int {
	counts := map[string][2]int{}
	fields := strings.Split(strings.TrimSuffix(string(out), "\x00"), "\x00")
	for i := 0; i < len(fields); i++ {
		parts := strings.SplitN(fields[i], "\t", 3)
		if len(parts) != 3 {
			continue
		}
		added, _ := strconv.Atoi(parts[0])
		deleted, _ := strconv.Atoi(parts[1])
		name := parts[2]
		if name == "" { // a rename: the old and new paths follow
			if i+2 >= len(fields) {
				break
			}
			name = fields[i+2]
			i += 2
		}
		counts[name] = [2]int{added, deleted}
	}
	return counts
}

func (s *Server) handleChanges(w http.ResponseWriter, r *http.Request, id string) error {
	space, err := s.running(r.Context(), id)
	if err != nil {
		return err
	}
	base := r.URL.Query().Get("base")
	branch := ""
	space.mu.Lock()
	if space.repo.Base != "" {
		base, branch = space.repo.Base, space.repo.Branch
	}
	space.mu.Unlock()
	if base == "" {
		out, err := s.exec(r.Context(), space, nil, nil, "sh", "-c", `git symbolic-ref --quiet --short refs/remotes/origin/HEAD | sed 's#^origin/##'`)
		if err != nil {
			return problem(409, "Ensure the workspace first.")
		}
		base = strings.TrimSpace(string(out))
	}
	if !validBranch(base) {
		return problem(400, "That branch name isn't one Kimono can use.")
	}
	if branch == "" {
		out, _ := s.exec(r.Context(), space, nil, nil, "git", "symbolic-ref", "--quiet", "--short", "HEAD")
		branch = strings.TrimSpace(string(out))
	}
	// Untracked files are listed by marking them intent-to-add; it records
	// nothing but their names, and committing them later is unaffected.
	out, err := s.exec(r.Context(), space, nil, nil, "sh", "-c",
		`git add -A -N >/dev/null 2>&1; git merge-base HEAD "origin/$1"`, "changes", base)
	if err != nil {
		return problem(409, "This branch has nothing in common with "+base+".")
	}
	mergeBase := strings.TrimSpace(string(out))
	names, err := s.exec(r.Context(), space, nil, nil, "git", "diff", "--name-status", "-z", "-M", mergeBase)
	if err != nil {
		return err
	}
	numbers, err := s.exec(r.Context(), space, nil, nil, "git", "diff", "--numstat", "-z", "-M", mergeBase)
	if err != nil {
		return err
	}
	diff, err := s.exec(r.Context(), space, nil, nil, "git", "diff", "-M", mergeBase)
	if err != nil {
		return err
	}
	files := parseNameStatus(names)
	counts := parseNumstat(numbers)
	for i := range files {
		files[i].Additions, files[i].Deletions = counts[files[i].Path][0], counts[files[i].Path][1]
	}
	truncated := len(diff) > maxDiffBytes
	if truncated {
		diff = diff[:maxDiffBytes]
	}
	writeJSON(w, 200, map[string]any{"base": base, "branch": branch, "files": files, "diff": string(diff), "truncated": truncated})
	return nil
}
