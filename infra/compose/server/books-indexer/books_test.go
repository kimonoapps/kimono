package main

import (
	"slices"
	"testing"
)

func TestNormalizeISBN(t *testing.T) {
	for raw, want := range map[string]string{
		"0-306-40615-2":      "9780306406157",
		"9780306406157":      "9780306406157",
		"0306406152 (pbk.)":  "9780306406157",
		"080442957X":         "9780804429573",
		"0306406153":         "", // bad check digit
		"978-0-306-40615-8":  "",
		"not an isbn":        "",
		"ISBN 0-306-40615-2": "9780306406157",
	} {
		if got := normalizeISBN(raw); got != want {
			t.Errorf("normalizeISBN(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestParseOpenLibrary(t *testing.T) {
	a, err := parseAuthor([]byte("/type/author\t/authors/OL1A\t1\t2021-12-26T21:20:34\t" + `{"name": "André Roth", "key": "/authors/OL1A", "birth_date": "1950"}`))
	if err != nil || a.Key != "/authors/OL1A" || a.Name != "André Roth" || a.BirthDate != "1950" {
		t.Fatalf("author = %+v, %v", a, err)
	}
	w, err := parseWork([]byte("/type/work\t/works/OL1W\t4\t2020-12-05\t" + `{"title": "A Romantic Way to Die", "covers": [-1, 217479], "key": "/works/OL1W",
		"authors": [{"author": {"key": "/authors/OL92934A"}}, {"author": "/authors/OL2A"}],
		"description": {"type": "/type/text", "value": "A mystery."}, "subjects": ["Texas", {"x": 1}, " "]}`))
	if err != nil || w.Title != "A Romantic Way to Die" || w.CoverID != 217479 || w.Description != "A mystery." ||
		!slices.Equal(w.AuthorKeys, []string{"/authors/OL92934A", "/authors/OL2A"}) || !slices.Equal(w.Subjects, []string{"Texas"}) {
		t.Fatalf("work = %+v, %v", w, err)
	}
	e, err := parseEdition([]byte("/type/edition\t/books/OL1M\t3\t2026-01-03\t" + `{"title": "Index", "publishers": ["Stationery Office Books"],
		"isbn_10": ["0306406152"], "isbn_13": ["9780306406157", "9780804429573"], "number_of_pages": "8", "works": [{"key": "/works/OL9W"}],
		"languages": [{"key": "/languages/eng"}], "key": "/books/OL1M"}`))
	if err != nil || e.WorkKey != "/works/OL9W" || e.Pages != 8 || !slices.Equal(e.Languages, []string{"eng"}) ||
		!slices.Equal(e.ISBNs, []string{"9780306406157", "9780804429573"}) {
		t.Fatalf("edition = %+v, %v", e, err)
	}
	if _, err := parseWork([]byte("/type/redirect\t/works/OL2W\t1\t2020\t{}")); err != errSkip {
		t.Fatalf("redirect: %v", err)
	}
}

func TestParseAACRecord(t *testing.T) {
	r, ok := parseAACRecord([]byte(`{"aacid": "aacid__isbndb__20240101__abc", "metadata": {"isbn13": "9780306406157",
		"title": "Signals", "authors": ["Ann Example"], "publisher": "Example Press", "date_published": "2011-03-02",
		"md5": "d41d8cd98f00b204e9800998ecf8427e", "download_url": "http://example.invalid/file"}}`))
	if !ok || r.Title != "Signals" || r.Year != 2011 || r.Publisher != "Example Press" ||
		!slices.Equal(r.Authors, []string{"Ann Example"}) || !slices.Equal(r.ISBNs, []string{"9780306406157"}) {
		t.Fatalf("record = %+v", r)
	}
	nested, ok := parseAACRecord([]byte(`{"aacid": "x", "metadata": {"record": {"title": {"value": "Deep"}, "creators": [{"name": "B"}], "isbns": ["0306406152"]}}}`))
	if !ok || nested.Title != "Deep" || !slices.Equal(nested.Authors, []string{"B"}) || !slices.Equal(nested.ISBNs, []string{"9780306406157"}) {
		t.Fatalf("nested = %+v", nested)
	}
	if _, ok := parseAACRecord([]byte(`{"aacid": "y", "metadata": {"md5": "abc"}}`)); ok {
		t.Fatal("a record with no title or ISBN is kept")
	}
}

func TestAAGroupsLeaveOutFileIndexes(t *testing.T) {
	list := []aaTorrent{
		{GroupName: "worldcat", IsMetadata: true, BTIH: "a", Magnet: "m"},
		{GroupName: "libgen_rs_non_fic", IsMetadata: true, BTIH: "b", Magnet: "m"},
		{GroupName: "zlib3_records", IsMetadata: true, BTIH: "c", Magnet: "m"},
		{GroupName: "isbndb", IsMetadata: true, Obsolete: true, BTIH: "d", Magnet: "m"},
		{GroupName: "books", IsMetadata: false, BTIH: "e", Magnet: "m"},
	}
	got := aaGroups(list, nil)
	if len(got) != 1 || got["worldcat"] == nil {
		t.Fatalf("groups = %v", got)
	}
	if got := aaGroups(list, []string{"zlib3_records"}); len(got) != 1 {
		t.Fatalf("an explicit choice is honoured: %v", got)
	}
}
