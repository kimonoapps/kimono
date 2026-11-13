package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Open Library publishes three monthly dumps. Each line is tab-separated:
// type, key, revision, last_modified, JSON record.
var openLibraryDumps = []string{"authors", "works", "editions"}

const openLibraryLatest = "https://openlibrary.org/data/ol_dump_%s_latest.txt.gz"

type author struct {
	Key, Name, BirthDate, DeathDate string
}

type work struct {
	Key, Title, Subtitle, FirstPublishDate, Description string
	AuthorKeys, Subjects                                []string
	CoverID                                             int64
}

type edition struct {
	Key, WorkKey, Title, Subtitle, PublishDate, PhysicalFormat string
	AuthorKeys, Publishers, Languages, ISBNs                   []string
	Pages                                                      int32
	CoverID                                                    int64
}

// keyRef is {"key": "/authors/OL1A"}; a few old records hold the bare string.
type keyRef struct{ Key string }

func (k *keyRef) UnmarshalJSON(data []byte) error {
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, &k.Key)
	}
	var v struct {
		Key string `json:"key"`
	}
	err := json.Unmarshal(data, &v)
	k.Key = v.Key
	return err
}

// text is a plain string or {"type": "/type/text", "value": "..."}.
type text string

func (t *text) UnmarshalJSON(data []byte) error {
	if len(data) > 0 && data[0] == '"' {
		return json.Unmarshal(data, (*string)(t))
	}
	var v struct {
		Value string `json:"value"`
	}
	if err := json.Unmarshal(data, &v); err != nil {
		return nil // anything else carries no text worth keeping
	}
	*t = text(v.Value)
	return nil
}

// lenientStrings keeps the strings of an array that also holds other values.
type lenientStrings []string

func (s *lenientStrings) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}
	for _, item := range raw {
		var v text
		if err := v.UnmarshalJSON(item); err == nil && v != "" {
			*s = append(*s, string(v))
		}
	}
	return nil
}

var errSkip = errors.New("not a record of this dump")

// splitLine returns the line's type and JSON record.
func splitLine(line []byte) (string, []byte, error) {
	fields := bytes.SplitN(line, []byte{'\t'}, 5)
	if len(fields) != 5 {
		return "", nil, errSkip
	}
	return string(fields[0]), fields[4], nil
}

func parseAuthor(line []byte) (author, error) {
	kind, record, err := splitLine(line)
	if err != nil || kind != "/type/author" {
		return author{}, errSkip
	}
	var v struct {
		Key       string `json:"key"`
		Name      text   `json:"name"`
		BirthDate text   `json:"birth_date"`
		DeathDate text   `json:"death_date"`
	}
	if err := json.Unmarshal(record, &v); err != nil {
		return author{}, err
	}
	return author{Key: clean(v.Key), Name: clean(string(v.Name)), BirthDate: clean(string(v.BirthDate)), DeathDate: clean(string(v.DeathDate))}, nil
}

func parseWork(line []byte) (work, error) {
	kind, record, err := splitLine(line)
	if err != nil || kind != "/type/work" {
		return work{}, errSkip
	}
	var v struct {
		Key              string         `json:"key"`
		Title            text           `json:"title"`
		Subtitle         text           `json:"subtitle"`
		FirstPublishDate text           `json:"first_publish_date"`
		Description      text           `json:"description"`
		Subjects         lenientStrings `json:"subjects"`
		Covers           []int64        `json:"covers"`
		Authors          []struct {
			Author keyRef `json:"author"`
		} `json:"authors"`
	}
	if err := json.Unmarshal(record, &v); err != nil {
		return work{}, err
	}
	w := work{
		Key: clean(v.Key), Title: clean(string(v.Title)), Subtitle: clean(string(v.Subtitle)),
		FirstPublishDate: clean(string(v.FirstPublishDate)), Description: clean(string(v.Description)),
		Subjects: cleanAll(v.Subjects), CoverID: firstCover(v.Covers),
	}
	for _, a := range v.Authors {
		if a.Author.Key != "" {
			w.AuthorKeys = append(w.AuthorKeys, clean(a.Author.Key))
		}
	}
	return w, nil
}

func parseEdition(line []byte) (edition, error) {
	kind, record, err := splitLine(line)
	if err != nil || kind != "/type/edition" {
		return edition{}, errSkip
	}
	var v struct {
		Key            string          `json:"key"`
		Title          text            `json:"title"`
		Subtitle       text            `json:"subtitle"`
		PublishDate    text            `json:"publish_date"`
		PhysicalFormat text            `json:"physical_format"`
		Publishers     lenientStrings  `json:"publishers"`
		ISBN10         lenientStrings  `json:"isbn_10"`
		ISBN13         lenientStrings  `json:"isbn_13"`
		Pages          json.RawMessage `json:"number_of_pages"`
		Covers         []int64         `json:"covers"`
		Works          []keyRef        `json:"works"`
		Authors        []keyRef        `json:"authors"`
		Languages      []keyRef        `json:"languages"`
	}
	if err := json.Unmarshal(record, &v); err != nil {
		return edition{}, err
	}
	e := edition{
		Key: clean(v.Key), Title: clean(string(v.Title)), Subtitle: clean(string(v.Subtitle)),
		PublishDate: clean(string(v.PublishDate)), PhysicalFormat: clean(string(v.PhysicalFormat)),
		Publishers: cleanAll(v.Publishers), CoverID: firstCover(v.Covers), Pages: pages(v.Pages),
	}
	if len(v.Works) > 0 {
		e.WorkKey = clean(v.Works[0].Key)
	}
	for _, a := range v.Authors {
		if a.Key != "" {
			e.AuthorKeys = append(e.AuthorKeys, clean(a.Key))
		}
	}
	for _, l := range v.Languages {
		if code := strings.TrimPrefix(l.Key, "/languages/"); code != "" {
			e.Languages = append(e.Languages, clean(code))
		}
	}
	seen := map[string]bool{}
	for _, raw := range append(v.ISBN10, v.ISBN13...) {
		if isbn := normalizeISBN(raw); isbn != "" && !seen[isbn] {
			seen[isbn] = true
			e.ISBNs = append(e.ISBNs, isbn)
		}
	}
	return e, nil
}

// firstCover skips the -1 placeholders Open Library leaves for removed covers.
func firstCover(covers []int64) int64 {
	for _, c := range covers {
		if c > 0 {
			return c
		}
	}
	return 0
}

func pages(raw json.RawMessage) int32 {
	s := strings.Trim(string(raw), `" `)
	n, err := strconv.ParseInt(s, 10, 32)
	if err != nil || n <= 0 || n > 100000 {
		return 0
	}
	return int32(n)
}

// normalizeISBN returns the ISBN-13 for a 10- or 13-digit ISBN, or "" when the
// value is not one. Lookups go through the same function, so either form finds a book.
func normalizeISBN(raw string) string {
	// Values like "0-306-40615-2 (pbk.)" are common: separators are dropped and
	// anything after the number is ignored.
	var digits []byte
scan:
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		switch {
		case c >= '0' && c <= '9':
			digits = append(digits, c)
		case (c == 'X' || c == 'x') && len(digits) == 9:
			digits = append(digits, 'X')
		case c == '-' || c == ' ':
		case len(digits) > 0:
			break scan
		}
	}
	switch len(digits) {
	case 13:
		if checkDigit13(digits[:12]) != digits[12] {
			return ""
		}
		return string(digits)
	case 10:
		if checkDigit10(digits[:9]) != digits[9] {
			return ""
		}
		thirteen := append([]byte("978"), digits[:9]...)
		return string(append(thirteen, checkDigit13(thirteen)))
	}
	return ""
}

func checkDigit10(nine []byte) byte {
	sum := 0
	for i, c := range nine {
		sum += int(c-'0') * (10 - i)
	}
	d := (11 - sum%11) % 11
	if d == 10 {
		return 'X'
	}
	return byte('0' + d)
}

func checkDigit13(twelve []byte) byte {
	sum := 0
	for i, c := range twelve {
		w := 1
		if i%2 == 1 {
			w = 3
		}
		sum += int(c-'0') * w
	}
	return byte('0' + (10-sum%10)%10)
}

// clean makes a value safe for Postgres text: valid UTF-8 without NUL bytes.
func clean(s string) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	if strings.IndexByte(s, 0) >= 0 {
		s = strings.ReplaceAll(s, "\x00", "")
	}
	return strings.TrimSpace(s)
}

func cleanAll(values []string) []string {
	out := values[:0]
	for _, v := range values {
		if v = clean(v); v != "" {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
