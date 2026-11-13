package main

import (
	"context"
	"strings"
)

// annasLive looks an ISBN up on Anna's Archive with a member's session, so
// pages answer without bot checks. It reads the metadata-only record Anna's
// keeps per ISBN (merged from ISBNdb, WorldCat, Open Library and others) and
// keeps its bibliographic fields; the membership's download API is never used.
type annasLive struct {
	base, cookie, path string
}

func (annasLive) Name() string { return "annas" }

func (a annasLive) url(isbn string) string {
	return strings.TrimRight(a.base, "/") + strings.ReplaceAll(a.path, "{isbn}", isbn)
}

func (a annasLive) ByISBN(ctx context.Context, isbn string) ([]liveRecord, error) {
	var record map[string]any
	if err := getJSON(ctx, a.url(isbn), map[string]string{"Cookie": a.cookie}, &record); err != nil {
		return nil, err
	}
	r, ok := pickBibliographic("isbn:"+isbn, record)
	if !ok {
		return nil, errNotFound
	}
	if len(r.ISBNs) == 0 {
		r.ISBNs = []string{isbn}
	}
	return []liveRecord{{
		Source: "live:annas", ID: r.ID, Title: r.Title, Authors: r.Authors, ISBNs: r.ISBNs,
		Year: r.Year, Publisher: r.Publisher, Language: r.Language, Description: r.Description,
	}}, nil
}

// Search is left to the other sources: Anna's search lists files, not books.
func (annasLive) Search(context.Context, string, int) ([]liveRecord, error) { return nil, nil }
