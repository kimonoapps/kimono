package main

import (
	"context"
	"errors"
	"slices"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// What live sources answer is kept in books_live, outside the schemas the
// dump imports replace, and heals itself: records are re-checked once they
// are a month old, and a lookup that found nothing is tried again after a
// day, a week, then every month.
const liveSchema = `
CREATE SCHEMA IF NOT EXISTS books_live;
CREATE OR REPLACE FUNCTION books_live.names(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
	AS $$ SELECT coalesce(array_to_string($1, ' '), '') $$;
CREATE TABLE IF NOT EXISTS books_live.records (
	source text NOT NULL, id text NOT NULL, title text NOT NULL, subtitle text, authors text[], isbns text[],
	genres text[], year int, pages int, publisher text, language text, description text, cover text,
	rating real, ratings int, readers int, checked_at timestamptz NOT NULL DEFAULT now(),
	search tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || coalesce(subtitle, '') || ' ' || books_live.names(authors))) STORED,
	PRIMARY KEY (source, id)
);
CREATE INDEX IF NOT EXISTS records_search ON books_live.records USING gin (search);
CREATE INDEX IF NOT EXISTS records_isbns ON books_live.records USING gin (isbns);
CREATE INDEX IF NOT EXISTS records_checked ON books_live.records (checked_at);
CREATE TABLE IF NOT EXISTS books_live.lookups (
	kind text NOT NULL, query text NOT NULL, found boolean NOT NULL, tries int NOT NULL DEFAULT 1,
	next_try timestamptz NOT NULL, PRIMARY KEY (kind, query)
);
`

const (
	staleAfter   = 30 * 24 * time.Hour
	searchFresh  = 7 * 24 * time.Hour
	liveDeadline = 10 * time.Second
)

// retryAfter is how long a miss waits before the next try.
func retryAfter(tries int) time.Duration {
	switch {
	case tries <= 1:
		return 24 * time.Hour
	case tries == 2:
		return 7 * 24 * time.Hour
	}
	return 30 * 24 * time.Hour
}

type live struct {
	pool    *pgxpool.Pool
	sources []liveSource
}

func newLive(ctx context.Context, pool *pgxpool.Pool, cfg config) (*live, error) {
	if _, err := pool.Exec(ctx, liveSchema); err != nil {
		return nil, err
	}
	l := &live{pool: pool, sources: []liveSource{openLibraryLive{}}}
	if cfg.GoogleKey != "" {
		l.sources = append(l.sources, googleBooks{key: cfg.GoogleKey})
	}
	if cfg.HardcoverToken != "" {
		l.sources = append(l.sources, hardcover{token: cfg.HardcoverToken})
	}
	if cfg.AABase != "" && cfg.AACookie != "" {
		l.sources = append(l.sources, annasLive{base: cfg.AABase, cookie: cfg.AACookie, path: cfg.AARecordPath})
	}
	return l, nil
}

// ask runs every source at once and keeps whatever they found.
func (l *live) ask(ctx context.Context, call func(liveSource) ([]liveRecord, error)) ([]liveRecord, error) {
	ctx, cancel := context.WithTimeout(ctx, liveDeadline)
	defer cancel()
	var mu sync.Mutex
	var found []liveRecord
	var errs []error
	var wg sync.WaitGroup
	for _, s := range l.sources {
		wg.Add(1)
		go func() {
			defer wg.Done()
			records, err := call(s)
			mu.Lock()
			defer mu.Unlock()
			if err != nil && !errors.Is(err, errNotFound) {
				errs = append(errs, err)
				logf("%s: %v", s.Name(), err)
			}
			found = append(found, records...)
		}()
	}
	wg.Wait()
	if len(found) > 0 {
		return found, l.save(context.WithoutCancel(ctx), found)
	}
	// Every source failing is not a miss: try again next time, not in a day.
	if len(errs) == len(l.sources) {
		return nil, errors.Join(errs...)
	}
	return nil, nil
}

func (l *live) save(ctx context.Context, records []liveRecord) error {
	batch := &pgx.Batch{}
	for _, r := range records {
		batch.Queue(`
INSERT INTO books_live.records (source, id, title, subtitle, authors, isbns, genres, year, pages, publisher, language, description, cover, rating, ratings, readers, checked_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
ON CONFLICT (source, id) DO UPDATE SET
	title = excluded.title, subtitle = coalesce(excluded.subtitle, records.subtitle),
	authors = coalesce(excluded.authors, records.authors),
	isbns = (SELECT array_agg(DISTINCT i) FROM unnest(coalesce(records.isbns, '{}') || coalesce(excluded.isbns, '{}')) i),
	genres = coalesce(excluded.genres, records.genres), year = coalesce(excluded.year, records.year),
	pages = coalesce(excluded.pages, records.pages), publisher = coalesce(excluded.publisher, records.publisher),
	language = coalesce(excluded.language, records.language), description = coalesce(excluded.description, records.description),
	cover = coalesce(excluded.cover, records.cover), rating = coalesce(excluded.rating, records.rating),
	ratings = coalesce(excluded.ratings, records.ratings), readers = coalesce(excluded.readers, records.readers),
	checked_at = now()`,
			r.Source, r.ID, r.Title, nullable(r.Subtitle), nilIfEmpty(r.Authors), nilIfEmpty(r.ISBNs), nilIfEmpty(r.Genres),
			nullableYear(r.Year), nullableYear(r.Pages), nullable(r.Publisher), nullable(r.Language), nullable(r.Description),
			nullable(r.Cover), nullableFloat(r.Rating), nullableYear(r.Ratings), nullableYear(r.Readers))
	}
	return l.pool.SendBatch(ctx, batch).Close()
}

// noteLookup remembers what a lookup found, so a miss is retried later
// rather than on every request.
func (l *live) noteLookup(ctx context.Context, kind, query string, found bool) {
	var tries int
	err := l.pool.QueryRow(ctx, "SELECT tries FROM books_live.lookups WHERE kind = $1 AND query = $2", kind, query).Scan(&tries)
	if err != nil {
		tries = 0
	}
	tries++
	if found {
		tries = 0
	}
	next := time.Now().Add(retryAfter(tries))
	if found && kind == "search" {
		next = time.Now().Add(searchFresh)
	} else if found {
		next = time.Now().Add(staleAfter)
	}
	l.pool.Exec(ctx, `
INSERT INTO books_live.lookups (kind, query, found, tries, next_try) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (kind, query) DO UPDATE SET found = excluded.found, tries = excluded.tries, next_try = excluded.next_try`,
		kind, query, found, tries, next)
}

// due says whether a lookup should go to the live sources now.
func (l *live) due(ctx context.Context, kind, query string) bool {
	var next time.Time
	err := l.pool.QueryRow(ctx, "SELECT next_try FROM books_live.lookups WHERE kind = $1 AND query = $2", kind, query).Scan(&next)
	return err != nil || time.Now().After(next)
}

// lookupISBN asks the live sources when the stored catalog has nothing
// fresh for an ISBN.
func (l *live) lookupISBN(ctx context.Context, isbn string, have int) {
	if have > 0 && !l.stale(ctx, isbn) {
		return
	}
	if !l.due(ctx, "isbn", isbn) {
		return
	}
	found, err := l.ask(ctx, func(s liveSource) ([]liveRecord, error) { return withISBN(s.ByISBN(ctx, isbn))(isbn) })
	if err != nil {
		return
	}
	l.noteLookup(context.WithoutCancel(ctx), "isbn", isbn, len(found) > 0 || have > 0)
}

// stale is true when no live record for the ISBN was checked this month.
func (l *live) stale(ctx context.Context, isbn string) bool {
	var fresh bool
	err := l.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM books_live.records WHERE isbns @> ARRAY[$1] AND checked_at > now() - $2::interval)",
		isbn, staleAfter.String()).Scan(&fresh)
	return err != nil || !fresh
}

// lookupSearch asks the live sources when a search found few books here.
func (l *live) lookupSearch(ctx context.Context, q string, limit, have int) {
	if have >= limit/2 || !l.due(ctx, "search", q) {
		return
	}
	found, err := l.ask(ctx, func(s liveSource) ([]liveRecord, error) { return s.Search(ctx, q, limit) })
	if err != nil {
		return
	}
	l.noteLookup(context.WithoutCancel(ctx), "search", q, len(found) > 0)
}

// heal runs in the background: re-checks month-old records and retries
// lookups whose wait is over.
func (l *live) heal(ctx context.Context) {
	for {
		select {
		case <-time.After(time.Hour):
		case <-ctx.Done():
			return
		}
		rows, err := l.pool.Query(ctx, `
SELECT kind, query FROM books_live.lookups WHERE next_try < now() AND kind = 'isbn' ORDER BY next_try LIMIT 200`)
		if err == nil {
			type lookup struct{ kind, query string }
			due, _ := pgx.CollectRows(rows, func(row pgx.CollectableRow) (lookup, error) {
				var k lookup
				return k, row.Scan(&k.kind, &k.query)
			})
			for _, d := range due {
				l.lookupISBN(ctx, d.query, 0)
				time.Sleep(time.Second) // gentle on the sources
			}
		}
		rows, err = l.pool.Query(ctx, `
SELECT isbns[1] FROM books_live.records WHERE checked_at < now() - $1::interval AND isbns IS NOT NULL ORDER BY checked_at LIMIT 200`, staleAfter.String())
		if err == nil {
			isbns, _ := pgx.CollectRows(rows, pgx.RowTo[string])
			for _, isbn := range isbns {
				if found, err := l.ask(ctx, func(s liveSource) ([]liveRecord, error) { return withISBN(s.ByISBN(ctx, isbn))(isbn) }); err == nil && len(found) == 0 {
					l.pool.Exec(ctx, "UPDATE books_live.records SET checked_at = now() WHERE isbns @> ARRAY[$1]", isbn)
				}
				time.Sleep(time.Second)
			}
		}
	}
}

const cachedColumns = `source, id, title, coalesce(subtitle, ''), coalesce(authors, '{}'), coalesce(year::text, ''),
	coalesce(publisher, ''), coalesce(isbns, '{}'), coalesce(cover, ''), coalesce(genres, '{}'), coalesce(description, ''),
	coalesce(pages, 0), coalesce(rating, 0), coalesce(ratings, 0), coalesce(readers, 0)`

func scanCached(row pgx.CollectableRow) (book, error) {
	var b book
	var rating float32
	err := row.Scan(&b.Source, &b.ID, &b.Title, &b.Subtitle, &b.Authors, &b.Year, &b.Publisher, &b.ISBNs, &b.Cover,
		&b.Genres, &b.Description, &b.Pages, &rating, &b.Ratings, &b.Readers)
	b.Rating = float64(rating)
	return b, err
}

func cachedByISBN(ctx context.Context, pool *pgxpool.Pool, isbn string) ([]book, error) {
	rows, err := pool.Query(ctx, "SELECT "+cachedColumns+" FROM books_live.records WHERE isbns @> ARRAY[$1] ORDER BY readers DESC NULLS LAST LIMIT 20", isbn)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanCached)
}

func cachedSearch(ctx context.Context, pool *pgxpool.Pool, q string, limit int) ([]book, error) {
	rows, err := pool.Query(ctx, "SELECT "+cachedColumns+` FROM books_live.records
WHERE search @@ plainto_tsquery('simple', $1)
ORDER BY readers DESC NULLS LAST, ratings DESC NULLS LAST LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanCached)
}

func nilIfEmpty(s []string) any {
	if len(s) == 0 {
		return nil
	}
	return s
}

func nullableFloat(f float64) any {
	if f <= 0 {
		return nil
	}
	return f
}

// withISBN makes sure every record found for an ISBN lists it: a work can
// carry hundreds of ISBNs and only some are kept.
func withISBN(records []liveRecord, err error) func(string) ([]liveRecord, error) {
	return func(isbn string) ([]liveRecord, error) {
		for i := range records {
			if !slices.Contains(records[i].ISBNs, isbn) {
				records[i].ISBNs = append([]string{isbn}, records[i].ISBNs...)
			}
		}
		return records, err
	}
}
