package main

import (
	"context"
	"os"
	"testing"
)

type fakeSource struct {
	calls   *int
	records []liveRecord
}

func (fakeSource) Name() string { return "fake" }
func (f fakeSource) ByISBN(context.Context, string) ([]liveRecord, error) {
	*f.calls++
	return f.records, nil
}
func (f fakeSource) Search(context.Context, string, int) ([]liveRecord, error) {
	*f.calls++
	return f.records, nil
}

// The live cache against a scratch Postgres (BOOKS_TEST_DATABASE_URL).
func TestLiveLookupsAreKeptAndMissesWait(t *testing.T) {
	url := os.Getenv("BOOKS_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("BOOKS_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	pool.Exec(ctx, "DROP SCHEMA IF EXISTS books_live CASCADE")
	lv, err := newLive(ctx, pool, config{})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	lv.sources = []liveSource{fakeSource{calls: &calls, records: []liveRecord{{
		Source: "live:fake", ID: "1", Title: "Niche Atlas", Authors: []string{"Cy Rare"},
		ISBNs: []string{"9780000000001"}, Genres: []string{"Maps"}, Rating: 4.2, Ratings: 10, Readers: 99,
	}}}}

	isbn := normalizeISBN("0-306-40615-2")
	books, err := lookupISBN(ctx, pool, lv, isbn)
	if err != nil || len(books) != 1 || books[0].Title != "Niche Atlas" || books[0].Readers != 99 || books[0].Genres[0] != "Maps" {
		t.Fatalf("first lookup = %+v, %v", books, err)
	}
	if books, _ := lookupISBN(ctx, pool, lv, isbn); len(books) != 1 || calls != 1 {
		t.Fatalf("a fresh record is answered from the cache: %d calls, %+v", calls, books)
	}

	// A miss is remembered: the next lookup within a day does not go out again.
	lv.sources = []liveSource{fakeSource{calls: &calls}}
	other := normalizeISBN("080442957X")
	lookupISBN(ctx, pool, lv, other)
	lookupISBN(ctx, pool, lv, other)
	if calls != 2 {
		t.Fatalf("a miss went out %d times", calls-1)
	}

	// Search: thin local results ask the sources and keep what they find.
	lv.sources = []liveSource{fakeSource{calls: &calls, records: []liveRecord{{Source: "live:fake", ID: "2", Title: "Copper Atlas", ISBNs: []string{"9780000000002"}}}}}
	if books, _ := searchAll(ctx, pool, lv, "copper atlas", 10); len(books) != 1 || books[0].Title != "Copper Atlas" {
		t.Fatalf("search = %+v", books)
	}
	searchAll(ctx, pool, lv, "copper atlas", 10)
	if calls != 3 {
		t.Fatalf("a search found a week ago went out again (%d calls)", calls)
	}
}
