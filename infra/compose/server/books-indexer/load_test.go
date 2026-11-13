package main

import (
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
)

// Runs against a scratch Postgres when BOOKS_TEST_DATABASE_URL names one.
func TestImportAndSearch(t *testing.T) {
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
	dir := t.TempDir()
	write := func(name, body string) string {
		path := filepath.Join(dir, name)
		f, _ := os.Create(path)
		gz := gzip.NewWriter(f)
		gz.Write([]byte(body))
		gz.Close()
		f.Close()
		return path
	}
	files := map[string]string{
		"authors": write("a.gz", "/type/author\t/authors/OL1A\t1\tx\t{\"name\": \"Ann Example\", \"key\": \"/authors/OL1A\"}\n"+
			"/type/author\t/authors/OL2A\t1\tx\t{\"name\": \"Bo Sample\", \"key\": \"/authors/OL2A\"}\n"),
		"works": write("w.gz", "/type/work\t/works/OL1W\t1\tx\t{\"title\": \"Quiet Rivers\", \"key\": \"/works/OL1W\", \"covers\": [42], \"authors\": [{\"author\": {\"key\": \"/authors/OL1A\"}}]}\n"+
			"/type/work\t/works/OL2W\t1\tx\t{\"title\": \"Loud Rivers\", \"key\": \"/works/OL2W\", \"authors\": [{\"author\": {\"key\": \"/authors/OL2A\"}}]}\n"+
			"/type/redirect\t/works/OL3W\t1\tx\t{}\n"),
		"editions": write("e.gz", "/type/edition\t/books/OL1M\t1\tx\t{\"title\": \"Quiet Rivers\", \"key\": \"/books/OL1M\", \"works\": [{\"key\": \"/works/OL1W\"}], \"isbn_10\": [\"0306406152\"], \"publishers\": [\"Example Press\"]}\n"+
			"/type/edition\t/books/OL2M\t1\tx\t{\"title\": \"Quiet Rivers (2nd)\", \"key\": \"/books/OL2M\", \"works\": [{\"key\": \"/works/OL1W\"}]}\n"),
	}
	st := &status{}
	for round := 0; round < 2; round++ { // a second import swaps over the first
		counts, err := importOpenLibrary(ctx, pool, "2026-10-3"+string(rune('0'+round)), files, st)
		if err != nil {
			t.Fatal(err)
		}
		if counts != (importCounts{Authors: 2, Works: 2, Editions: 2}) {
			t.Fatalf("counts = %+v", counts)
		}
	}
	if date, _ := lastImport(ctx, pool); date != "2026-10-31" {
		t.Fatalf("last import = %q", date)
	}
	books, err := search(ctx, pool, "rivers", 10)
	if err != nil || len(books) != 2 || books[0].ID != "/works/OL1W" || books[0].Editions != 2 || books[0].Authors[0] != "Ann Example" || books[0].Cover == "" {
		t.Fatalf("search rivers = %+v, %v", books, err)
	}
	if books, err := search(ctx, pool, "sample", 10); err != nil || len(books) != 1 || books[0].ID != "/works/OL2W" {
		t.Fatalf("search by author = %+v, %v", books, err)
	}

	// An Anna's Archive collection, zstd like the real AAC files.
	aac := filepath.Join(dir, "annas_archive_meta__aacid__isbndb__1.jsonl.seekable.zst")
	f, _ := os.Create(aac)
	z, _ := zstd.NewWriter(f)
	z.Write([]byte(`{"aacid": "aacid__isbndb__1", "metadata": {"isbn13": "9780306406157", "title": "Quiet Rivers", "authors": ["Ann Example"], "date_published": "2011"}}` + "\n" +
		`{"aacid": "aacid__isbndb__2", "metadata": {"title": "Copper Hills", "md5": "abc"}}` + "\n"))
	z.Close()
	f.Close()
	for round := 0; round < 2; round++ {
		if err := loadAACollection(ctx, pool, "isbndb", "v"+string(rune('1'+round)), []string{aac}, st); err != nil {
			t.Fatal(err)
		}
	}
	books, err = byISBN(ctx, pool, normalizeISBN("0-306-40615-2"))
	if err != nil || len(books) != 2 || books[0].Source != "openlibrary" || books[1].Source != "aa:isbndb" || books[1].Year != "2011" {
		t.Fatalf("isbn = %+v, %v", books, err)
	}
	if books, err := search(ctx, pool, "copper", 10); err != nil || len(books) != 1 || books[0].Source != "aa:isbndb" {
		t.Fatalf("search copper = %+v, %v", books, err)
	}
}
