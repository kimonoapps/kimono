package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/klauspost/compress/zstd"
)

// aaTorrent is one entry of Anna's Archive's torrents.json.
type aaTorrent struct {
	GroupName  string `json:"group_name"`
	TopGroup   string `json:"top_level_group_name"`
	Display    string `json:"display_name"`
	IsMetadata bool   `json:"is_metadata"`
	Obsolete   bool   `json:"obsolete"`
	Embargo    bool   `json:"embargo"`
	BTIH       string `json:"btih"`
	Magnet     string `json:"magnet_link"`
	DataSize   int64  `json:"data_size"`
	AddedAt    string `json:"added_to_torrents_list_at"`
}

// Collections that only index shadow-library files (their records exist to
// point at a copy of a book) are left out: Kimono Books keeps catalog
// metadata. aa_derived_mirror_metadata is Anna's own search index, a
// different format, and repeats the others.
var aaSkippedGroups = regexp.MustCompile(`(?i)libgen|zlib|scihub|nexusstc|upload|magzdb|aa_derived|torrents_byteoffsets`)

func aaTorrents(ctx context.Context, listURL string) ([]aaTorrent, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("torrent list: %s", res.Status)
	}
	var list []aaTorrent
	if err := json.NewDecoder(res.Body).Decode(&list); err != nil {
		return nil, fmt.Errorf("torrent list is not Anna's Archive's torrents.json (is %s the right address?): %w", listURL, err)
	}
	return list, nil
}

// aaGroups picks the current metadata torrents of each wanted collection.
func aaGroups(list []aaTorrent, wanted []string) map[string][]aaTorrent {
	allow := map[string]bool{}
	for _, g := range wanted {
		allow[g] = true
	}
	groups := map[string][]aaTorrent{}
	for _, t := range list {
		if !t.IsMetadata || t.Obsolete || t.Embargo || t.Magnet == "" || t.BTIH == "" {
			continue
		}
		if len(allow) > 0 && !allow[t.GroupName] {
			continue
		}
		if len(allow) == 0 && aaSkippedGroups.MatchString(t.GroupName) {
			continue
		}
		groups[t.GroupName] = append(groups[t.GroupName], t)
	}
	return groups
}

// aaVersion names a collection's torrent set; a new set means a new import.
func aaVersion(torrents []aaTorrent) string {
	hashes := make([]string, len(torrents))
	for i, t := range torrents {
		hashes[i] = strings.ToLower(t.BTIH)
	}
	sort.Strings(hashes)
	sum := sha256.Sum256([]byte(strings.Join(hashes, ",")))
	return hex.EncodeToString(sum[:8])
}

const recordsTable = `
CREATE SCHEMA IF NOT EXISTS books_extra;
CREATE OR REPLACE FUNCTION books_extra.names(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
	AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;
CREATE TABLE IF NOT EXISTS books_extra.records (
	source text NOT NULL, record_id text NOT NULL, title text NOT NULL, authors text[],
	isbns text[], year int, publisher text, language text,
	search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || books_extra.names(authors))) STORED
) PARTITION BY LIST (source);
`

// importAACollection fetches one collection through Real-Debrid, keeps its
// files, and replaces that collection's partition of books_extra.records.
func importAACollection(ctx context.Context, pool *pgxpool.Pool, cfg config, group string, torrents []aaTorrent, st *status) error {
	key, err := debridKey(ctx, cfg)
	if err != nil {
		return err
	}
	rd := realDebrid{key: key}
	dir := filepath.Join(cfg.Dir, "dumps", "annas", group)
	var files []string
	for _, t := range torrents {
		label := t.Display
		if label == "" {
			label = group
		}
		dumps, err := rd.torrentFiles(ctx, t.Magnet, t.BTIH, st, label)
		if err != nil {
			return err
		}
		for _, d := range dumps {
			st.set("downloading "+d.Name, 0, d.Size)
			file, err := fetch(ctx, d, dir, st.progress)
			if err != nil {
				return err
			}
			files = append(files, file)
		}
	}
	return loadAACollection(ctx, pool, group, aaVersion(torrents), files, st)
}

// loadAACollection replaces one collection's partition with the records in files.
func loadAACollection(ctx context.Context, pool *pgxpool.Pool, group, version string, files []string, st *status) error {
	started := time.Now()
	source := "aa:" + group
	part := "records_" + regexp.MustCompile(`[^a-z0-9_]`).ReplaceAllString(strings.ToLower(group), "_")
	next := part + "_next"
	if _, err := pool.Exec(ctx, importsTable+recordsTable+fmt.Sprintf(`
DROP TABLE IF EXISTS books_extra.%[1]s;
CREATE TABLE books_extra.%[1]s (LIKE books_extra.records INCLUDING GENERATED);
ALTER TABLE books_extra.%[1]s ADD CHECK (source = %[2]s);`, next, quote(source))); err != nil {
		return err
	}
	var count int64
	for _, file := range files {
		if !isAACFile(file) {
			logf("%s: %s is not an AAC JSON lines file; kept, not loaded", group, filepath.Base(file))
			continue
		}
		st.set("loading "+filepath.Base(file), 0, 0)
		err := pipeAAC(ctx, file, st, func(ctx context.Context, line []byte, out []chan []any) {
			if r, ok := parseAACRecord(line); ok {
				send(ctx, out[0], []any{source, r.ID, r.Title, r.Authors, r.ISBNs, nullableYear(r.Year), nullable(r.Publisher), nullable(r.Language)})
			}
		}, func(ctx context.Context, rows <-chan []any) error {
			n, err := pool.CopyFrom(ctx, pgx.Identifier{"books_extra", next},
				[]string{"source", "record_id", "title", "authors", "isbns", "year", "publisher", "language"}, &chanSource{rows: rows})
			count += n
			return err
		})
		if err != nil {
			return fmt.Errorf("%s: %w", filepath.Base(file), err)
		}
	}
	st.set("indexing "+group, 0, 0)
	if _, err := pool.Exec(ctx, fmt.Sprintf(`
CREATE INDEX ON books_extra.%[1]s USING gin (search);
CREATE INDEX ON books_extra.%[1]s USING gin (isbns);
ANALYZE books_extra.%[1]s;`, next)); err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, fmt.Sprintf(`
DROP TABLE IF EXISTS books_extra.%[1]s;
ALTER TABLE books_extra.%[2]s RENAME TO %[1]s;
ALTER TABLE books_extra.records ATTACH PARTITION books_extra.%[1]s FOR VALUES IN (%[3]s);`, part, next, quote(source))); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "INSERT INTO public.book_imports (source, dump_date, started_at, finished_at, authors, works, editions) VALUES ($1, $2, $3, now(), 0, $4, 0)",
			source, version, started, count)
		return err
	})
}

func lastImportOf(ctx context.Context, pool *pgxpool.Pool, source string) (string, error) {
	if _, err := pool.Exec(ctx, importsTable); err != nil {
		return "", err
	}
	var v string
	err := pool.QueryRow(ctx, "SELECT dump_date FROM public.book_imports WHERE source = $1 ORDER BY id DESC LIMIT 1", source).Scan(&v)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return v, err
}

func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func isAACFile(name string) bool {
	for _, ext := range []string{".jsonl.seekable.zst", ".jsonl.zst", ".jsonl.gz", ".jsonl"} {
		if strings.HasSuffix(name, ext) {
			return true
		}
	}
	return false
}

// pipeAAC is pipe() for AAC files, which may be zstd, gzip or plain.
func pipeAAC(ctx context.Context, file string, st *status,
	handle func(ctx context.Context, line []byte, out []chan []any),
	sink func(ctx context.Context, rows <-chan []any) error) error {
	return pipeWith(ctx, file, st, 1, openAAC, handle, func(ctx context.Context, _ int, rows <-chan []any) error { return sink(ctx, rows) })
}

func openAAC(r io.Reader, name string) (io.ReadCloser, error) {
	switch {
	case strings.HasSuffix(name, ".zst"):
		d, err := zstd.NewReader(r, zstd.WithDecoderMaxWindow(1<<31))
		if err != nil {
			return nil, err
		}
		return d.IOReadCloser(), nil
	case strings.HasSuffix(name, ".gz"):
		return gzip.NewReader(r)
	}
	return io.NopCloser(bufio.NewReader(r)), nil
}

type aaRecord struct {
	ID, Title, Publisher, Language string
	Authors, ISBNs                 []string
	Year                           int
}

var yearPattern = regexp.MustCompile(`\b(1[4-9]\d\d|20\d\d)\b`)

// parseAACRecord reads an Anna's Archive Container line: {"aacid": ...,
// "metadata": {...}}. Every collection shapes its metadata differently, so
// the usual bibliographic keys are looked for by name a few levels down.
// Only those keys are read: file names, hashes and links never are.
func parseAACRecord(line []byte) (aaRecord, bool) {
	var v struct {
		AACID    string         `json:"aacid"`
		Metadata map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal(line, &v); err != nil || v.AACID == "" || v.Metadata == nil {
		return aaRecord{}, false
	}
	r := aaRecord{ID: clean(v.AACID)}
	seenISBN := map[string]bool{}
	var walk func(m map[string]any, depth int)
	walk = func(m map[string]any, depth int) {
		for k, val := range m {
			key := strings.ToLower(k)
			switch {
			case strings.Contains(key, "isbn"):
				for _, s := range stringsOf(val) {
					if isbn := normalizeISBN(s); isbn != "" && !seenISBN[isbn] {
						seenISBN[isbn] = true
						r.ISBNs = append(r.ISBNs, isbn)
					}
				}
			case key == "title" || key == "title_best" || key == "book_title":
				if r.Title == "" {
					r.Title = first(val)
				}
			case key == "author" || key == "authors" || key == "creator" || key == "creators" || key == "author_name" || key == "author_best":
				if len(r.Authors) == 0 {
					r.Authors = cleanAll(stringsOf(val))
				}
			case key == "publisher" || key == "publishers" || key == "publisher_best":
				if r.Publisher == "" {
					r.Publisher = first(val)
				}
			case key == "language" || key == "languages" || key == "language_codes":
				if r.Language == "" {
					r.Language = first(val)
				}
			case key == "year" || key == "year_best" || key == "publish_year" || key == "publication_year" || key == "date_published" || key == "publication_date" || key == "publish_date" || key == "pubdate":
				if r.Year == 0 {
					if y := yearPattern.FindString(first(val)); y != "" {
						r.Year, _ = strconv.Atoi(y)
					}
				}
			default:
				if child, ok := val.(map[string]any); ok && depth < 3 {
					walk(child, depth+1)
				}
			}
		}
	}
	walk(v.Metadata, 0)
	r.Title = truncate(r.Title, 2000)
	if r.Title == "" && len(r.ISBNs) == 0 {
		return aaRecord{}, false
	}
	if r.Title == "" {
		r.Title = r.ISBNs[0]
	}
	return r, true
}

// stringsOf flattens a value into its strings: a string, numbers, an array,
// or objects carrying a "name"/"value".
func stringsOf(v any) []string {
	switch t := v.(type) {
	case string:
		return []string{t}
	case float64:
		return []string{strconv.FormatFloat(t, 'f', -1, 64)}
	case []any:
		var out []string
		for _, item := range t {
			out = append(out, stringsOf(item)...)
		}
		return out
	case map[string]any:
		for _, k := range []string{"name", "value", "text"} {
			if s, ok := t[k].(string); ok {
				return []string{s}
			}
		}
	}
	return nil
}

func first(v any) string {
	for _, s := range stringsOf(v) {
		if s = clean(s); s != "" {
			return s
		}
	}
	return ""
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return strings.ToValidUTF8(s[:n], "")
}

func nullableYear(y int) any {
	if y == 0 {
		return nil
	}
	return y
}
