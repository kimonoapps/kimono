package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// The catalog lives in schema "books". An import fills "books_next" and
// swaps it in at the end, so search keeps answering from the previous
// catalog for the hours a full import takes.
const stagingSchema = `
DROP SCHEMA IF EXISTS books_next CASCADE;
CREATE SCHEMA books_next;
CREATE TABLE books_next.authors (
	key text NOT NULL, name text NOT NULL, birth_date text, death_date text,
	search tsvector GENERATED ALWAYS AS (to_tsvector('simple', name)) STORED
);
CREATE TABLE books_next.works_raw (
	key text NOT NULL, title text NOT NULL, subtitle text, author_keys text[],
	first_publish_date text, subjects text[], cover_id bigint, description text
);
CREATE TABLE books_next.editions (
	key text NOT NULL, work_key text, title text, subtitle text, author_keys text[],
	publishers text[], publish_date text, physical_format text, pages int,
	languages text[], cover_id bigint
);
CREATE TABLE books_next.isbns (isbn text NOT NULL, edition_key text NOT NULL);
`

// finishSchema runs once every dump is loaded: works gain their edition counts
// (search ranks by them) and every table gets its indexes.
const finishSchema = `
CREATE TABLE books_next.works (
	key text NOT NULL, title text NOT NULL, subtitle text, author_keys text[],
	first_publish_date text, subjects text[], cover_id bigint, description text,
	edition_count int NOT NULL DEFAULT 0,
	search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || coalesce(subtitle, ''))) STORED
);
INSERT INTO books_next.works (key, title, subtitle, author_keys, first_publish_date, subjects, cover_id, description, edition_count)
SELECT w.key, w.title, w.subtitle, w.author_keys, w.first_publish_date, w.subjects, w.cover_id, w.description, coalesce(c.n, 0)
FROM books_next.works_raw w
LEFT JOIN (SELECT work_key, count(*)::int AS n FROM books_next.editions GROUP BY work_key) c ON c.work_key = w.key;
DROP TABLE books_next.works_raw;
CREATE INDEX ON books_next.authors (key);
CREATE INDEX ON books_next.authors USING gin (search);
CREATE INDEX ON books_next.works (key);
CREATE INDEX ON books_next.works USING gin (search);
CREATE INDEX ON books_next.works USING gin (author_keys);
CREATE INDEX ON books_next.editions (key);
CREATE INDEX ON books_next.editions (work_key);
CREATE INDEX ON books_next.isbns (isbn);
ANALYZE books_next.authors;
ANALYZE books_next.works;
ANALYZE books_next.editions;
ANALYZE books_next.isbns;
`

const importsTable = `
CREATE TABLE IF NOT EXISTS public.book_imports (
	id bigserial PRIMARY KEY, source text NOT NULL, dump_date text NOT NULL,
	started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL,
	authors bigint NOT NULL, works bigint NOT NULL, editions bigint NOT NULL
);
`

type importCounts struct{ Authors, Works, Editions int64 }

// importOpenLibrary loads the three dump files into the catalog.
func importOpenLibrary(ctx context.Context, pool *pgxpool.Pool, date string, files map[string]string, status *status) (importCounts, error) {
	started := time.Now()
	var counts importCounts
	if _, err := pool.Exec(ctx, importsTable+stagingSchema); err != nil {
		return counts, fmt.Errorf("staging schema: %w", err)
	}
	var err error
	status.set("loading authors", 0, 0)
	if counts.Authors, err = copyDump(ctx, pool, files["authors"], status, "authors", authorRows); err != nil {
		return counts, err
	}
	status.set("loading works", 0, 0)
	if counts.Works, err = copyDump(ctx, pool, files["works"], status, "works", workRows); err != nil {
		return counts, err
	}
	status.set("loading editions", 0, 0)
	if counts.Editions, err = copyEditions(ctx, pool, files["editions"], status); err != nil {
		return counts, err
	}
	status.set("indexing", 0, 0)
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return counts, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SET maintenance_work_mem = '1GB'; SET max_parallel_maintenance_workers = 4"); err != nil {
		return counts, err
	}
	if _, err := conn.Exec(ctx, finishSchema); err != nil {
		return counts, fmt.Errorf("indexing: %w", err)
	}
	status.set("switching to the new catalog", 0, 0)
	err = pgx.BeginFunc(ctx, conn.Conn(), func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "DROP SCHEMA IF EXISTS books CASCADE; ALTER SCHEMA books_next RENAME TO books"); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, "INSERT INTO public.book_imports (source, dump_date, started_at, finished_at, authors, works, editions) VALUES ('openlibrary', $1, $2, now(), $3, $4, $5)",
			date, started, counts.Authors, counts.Works, counts.Editions)
		return err
	})
	return counts, err
}

// lastImport is the dump date of the catalog being served, or "".
func lastImport(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	if _, err := pool.Exec(ctx, importsTable); err != nil {
		return "", err
	}
	var date string
	err := pool.QueryRow(ctx, "SELECT dump_date FROM public.book_imports WHERE source = 'openlibrary' ORDER BY id DESC LIMIT 1").Scan(&date)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return date, err
}

type rowParser func(line []byte) ([]any, error)

func authorRows(line []byte) ([]any, error) {
	a, err := parseAuthor(line)
	if err != nil || a.Key == "" || a.Name == "" {
		return nil, errSkip
	}
	return []any{a.Key, a.Name, nullable(a.BirthDate), nullable(a.DeathDate)}, nil
}

func workRows(line []byte) ([]any, error) {
	w, err := parseWork(line)
	if err != nil || w.Key == "" || w.Title == "" {
		return nil, errSkip
	}
	return []any{w.Key, w.Title, nullable(w.Subtitle), w.AuthorKeys, nullable(w.FirstPublishDate), w.Subjects, nullableID(w.CoverID), nullable(w.Description)}, nil
}

var copyColumns = map[string][]string{
	"authors":  {"key", "name", "birth_date", "death_date"},
	"works":    {"key", "title", "subtitle", "author_keys", "first_publish_date", "subjects", "cover_id", "description"},
	"editions": {"key", "work_key", "title", "subtitle", "author_keys", "publishers", "publish_date", "physical_format", "pages", "languages", "cover_id"},
	"isbns":    {"isbn", "edition_key"},
}

// copyDump streams a gzipped dump into one table, parsing on every core.
func copyDump(ctx context.Context, pool *pgxpool.Pool, file string, status *status, table string, parse rowParser) (int64, error) {
	target := table
	if table == "works" {
		target = "works_raw"
	}
	var n int64
	err := pipe(ctx, file, status, []string{target}, func(ctx context.Context, line []byte, out []chan []any) {
		if row, err := parse(line); err == nil {
			send(ctx, out[0], row)
		}
	}, func(ctx context.Context, i int, rows <-chan []any) (err error) {
		n, err = pool.CopyFrom(ctx, pgx.Identifier{"books_next", target}, copyColumns[table], &chanSource{rows: rows})
		return err
	})
	if err != nil {
		return n, fmt.Errorf("%s: %w", table, err)
	}
	return n, nil
}

// copyEditions fills editions and isbns together from one pass over the dump.
func copyEditions(ctx context.Context, pool *pgxpool.Pool, file string, status *status) (int64, error) {
	tables := []string{"editions", "isbns"}
	counts := make([]int64, 2)
	err := pipe(ctx, file, status, tables, func(ctx context.Context, line []byte, out []chan []any) {
		e, err := parseEdition(line)
		if err != nil || e.Key == "" {
			return
		}
		send(ctx, out[0], []any{e.Key, nullable(e.WorkKey), nullable(e.Title), nullable(e.Subtitle), e.AuthorKeys, e.Publishers,
			nullable(e.PublishDate), nullable(e.PhysicalFormat), nullablePages(e.Pages), e.Languages, nullableID(e.CoverID)})
		for _, isbn := range e.ISBNs {
			send(ctx, out[1], []any{isbn, e.Key})
		}
	}, func(ctx context.Context, i int, rows <-chan []any) (err error) {
		counts[i], err = pool.CopyFrom(ctx, pgx.Identifier{"books_next", tables[i]}, copyColumns[tables[i]], &chanSource{rows: rows})
		return err
	})
	if err != nil {
		return counts[0], fmt.Errorf("editions: %w", err)
	}
	return counts[0], nil
}

func send(ctx context.Context, out chan<- []any, row []any) {
	select {
	case out <- row:
	case <-ctx.Done():
	}
}

// pipe reads a gzipped dump, parses its lines on every core into one channel
// per sink, and runs each sink (a COPY) alongside. The first failure stops all.
func pipe(ctx context.Context, file string, status *status, sinks []string,
	handle func(ctx context.Context, line []byte, out []chan []any),
	sink func(ctx context.Context, i int, rows <-chan []any) error) error {
	return pipeWith(ctx, file, status, len(sinks), openGzip, handle, sink)
}

func openGzip(r io.Reader, _ string) (io.ReadCloser, error) { return gzip.NewReader(r) }

func pipeWith(ctx context.Context, file string, status *status, sinks int,
	open func(r io.Reader, name string) (io.ReadCloser, error),
	handle func(ctx context.Context, line []byte, out []chan []any),
	sink func(ctx context.Context, i int, rows <-chan []any) error) error {
	ctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	out := make([]chan []any, sinks)
	var sinksDone sync.WaitGroup
	for i := range sinks {
		out[i] = make(chan []any, 4096)
		sinksDone.Add(1)
		go func() {
			defer sinksDone.Done()
			if err := sink(ctx, i, out[i]); err != nil {
				cancel(err)
				for range out[i] {
				}
			}
		}()
	}
	readErr := readLines(ctx, file, status, open, func(line []byte) { handle(ctx, line, out) })
	if readErr != nil {
		cancel(readErr)
	}
	for _, ch := range out {
		close(ch)
	}
	sinksDone.Wait()
	if err := context.Cause(ctx); err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return ctx.Err()
}

// readLines decompresses the dump and hands each line to a pool of workers.
func readLines(ctx context.Context, file string, status *status, open func(io.Reader, string) (io.ReadCloser, error), handle func(line []byte)) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	counted := &countingReader{r: f}
	gz, err := open(bufio.NewReaderSize(counted, 1<<20), file)
	if err != nil {
		return err
	}
	defer gz.Close()
	lines := make(chan []byte, 8192)
	var wg sync.WaitGroup
	for range max(runtime.NumCPU()-1, 1) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for line := range lines {
				handle(line)
			}
		}()
	}
	defer func() { close(lines); wg.Wait() }()
	scanner := bufio.NewScanner(gz)
	scanner.Buffer(make([]byte, 1<<20), 64<<20)
	last := time.Now()
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		select {
		case lines <- line:
		case <-ctx.Done():
			return ctx.Err()
		}
		if time.Since(last) > 2*time.Second {
			status.progress(counted.n.Load(), info.Size())
			last = time.Now()
		}
	}
	return scanner.Err()
}

type countingReader struct {
	r io.Reader
	n atomic.Int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n.Add(int64(n))
	return n, err
}

// chanSource feeds pgx's COPY from a channel of rows.
type chanSource struct {
	rows <-chan []any
	row  []any
}

func (s *chanSource) Next() bool {
	row, ok := <-s.rows
	s.row = row
	return ok
}
func (s *chanSource) Values() ([]any, error) { return s.row, nil }
func (s *chanSource) Err() error             { return nil }

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func nullableID(id int64) any {
	if id <= 0 {
		return nil
	}
	return id
}

func nullablePages(n int32) any {
	if n <= 0 {
		return nil
	}
	return n
}
