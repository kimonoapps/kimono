package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// book is one search result: an Open Library work, or a record from one of
// Anna's Archive's catalog collections (source "aa:<collection>").
type book struct {
	Source    string   `json:"source"`
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Subtitle  string   `json:"subtitle,omitempty"`
	Authors   []string `json:"authors"`
	Year      string   `json:"year,omitempty"`
	Publisher string   `json:"publisher,omitempty"`
	ISBNs     []string `json:"isbns,omitempty"`
	Cover     string   `json:"cover,omitempty"`
	Editions  int      `json:"editions,omitempty"`
}

func coverURL(id *int64) string {
	if id == nil {
		return ""
	}
	return fmt.Sprintf("https://covers.openlibrary.org/b/id/%d-M.jpg", *id)
}

// Works match on their title, or on an author whose name matches; the most
// published come first.
const searchWorks = `
WITH q AS (SELECT plainto_tsquery('simple', $1) AS q),
by_author AS (SELECT coalesce(array_agg(key), '{}') AS keys FROM (SELECT a.key FROM books.authors a, q WHERE a.search @@ q.q LIMIT 200) s)
SELECT w.key, w.title, coalesce(w.subtitle, ''), coalesce(w.first_publish_date, ''), w.cover_id, w.edition_count,
	ARRAY(SELECT a.name FROM books.authors a WHERE a.key = ANY(w.author_keys))
FROM books.works w, q, by_author
WHERE w.search @@ q.q OR w.author_keys && by_author.keys
ORDER BY w.edition_count DESC
LIMIT $2`

const searchRecords = `
SELECT source, record_id, title, coalesce(authors, '{}'), coalesce(year::text, ''), coalesce(publisher, ''), coalesce(isbns, '{}')
FROM books_extra.records
WHERE search @@ plainto_tsquery('simple', $1)
LIMIT $2`

func search(ctx context.Context, pool *pgxpool.Pool, q string, limit int) ([]book, error) {
	rows, err := pool.Query(ctx, searchWorks, q, limit)
	if err != nil {
		return nil, err
	}
	books, err := pgx.CollectRows(rows, scanWork)
	if err != nil {
		return nil, err
	}
	// Anna's Archive collections are optional: none loaded is no error.
	if rows, err := pool.Query(ctx, searchRecords, q, limit); err == nil {
		if more, err := pgx.CollectRows(rows, scanRecord); err == nil {
			books = append(books, more...)
		}
	}
	return books, nil
}

func byISBN(ctx context.Context, pool *pgxpool.Pool, isbn string) ([]book, error) {
	rows, err := pool.Query(ctx, `
SELECT e.key, coalesce(e.title, w.title, ''), coalesce(e.subtitle, w.subtitle, ''), coalesce(e.publish_date, ''),
	coalesce(e.cover_id, w.cover_id), coalesce(e.publishers[1], ''), coalesce(w.key, ''),
	ARRAY(SELECT a.name FROM books.authors a WHERE a.key = ANY(coalesce(w.author_keys, e.author_keys)))
FROM books.isbns i
JOIN books.editions e ON e.key = i.edition_key
LEFT JOIN books.works w ON w.key = e.work_key
WHERE i.isbn = $1
LIMIT 20`, isbn)
	if err != nil {
		return nil, err
	}
	books, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (book, error) {
		var b book
		var cover *int64
		var work string
		err := row.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Year, &cover, &b.Publisher, &work, &b.Authors)
		b.Source, b.Cover, b.ISBNs = "openlibrary", coverURL(cover), []string{isbn}
		return b, err
	})
	if err != nil {
		return nil, err
	}
	if rows, err := pool.Query(ctx, `
SELECT source, record_id, title, coalesce(authors, '{}'), coalesce(year::text, ''), coalesce(publisher, ''), coalesce(isbns, '{}')
FROM books_extra.records WHERE isbns @> ARRAY[$1] LIMIT 20`, isbn); err == nil {
		if more, err := pgx.CollectRows(rows, scanRecord); err == nil {
			books = append(books, more...)
		}
	}
	return books, nil
}

func scanWork(row pgx.CollectableRow) (book, error) {
	var b book
	var cover *int64
	err := row.Scan(&b.ID, &b.Title, &b.Subtitle, &b.Year, &cover, &b.Editions, &b.Authors)
	b.Source, b.Cover = "openlibrary", coverURL(cover)
	return b, err
}

func scanRecord(row pgx.CollectableRow) (book, error) {
	var b book
	err := row.Scan(&b.Source, &b.ID, &b.Title, &b.Authors, &b.Year, &b.Publisher, &b.ISBNs)
	return b, err
}
