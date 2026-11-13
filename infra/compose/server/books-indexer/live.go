package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// liveRecord is a book as a live source describes it. Records are kept in
// books_live.records and refreshed when they get old (cache.go).
type liveRecord struct {
	Source, ID                           string
	Title, Subtitle, Publisher, Language string
	Description, Cover                   string
	Authors, ISBNs, Genres               []string
	Year, Pages                          int
	Rating                               float64
	Ratings, Readers                     int
}

// liveSource answers lookups the stored catalog could not.
type liveSource interface {
	Name() string
	ByISBN(ctx context.Context, isbn string) ([]liveRecord, error)
	Search(ctx context.Context, q string, limit int) ([]liveRecord, error)
}

var errNotFound = errors.New("not found")

func getJSON(ctx context.Context, rawURL string, headers map[string]string, into any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return errNotFound
	}
	if res.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("%s: %s %s", req.URL.Host, res.Status, strings.TrimSpace(string(msg)))
	}
	return json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(into)
}

func postJSON(ctx context.Context, rawURL string, headers map[string]string, body, into any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, rawURL, strings.NewReader(string(data)))
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		msg, _ := io.ReadAll(io.LimitReader(res.Body, 300))
		return fmt.Errorf("%s: %s %s", req.URL.Host, res.Status, strings.TrimSpace(string(msg)))
	}
	return json.NewDecoder(io.LimitReader(res.Body, 32<<20)).Decode(into)
}

func yearOf(s string) int {
	y, _ := strconv.Atoi(yearPattern.FindString(s))
	return y
}

// ── Open Library, live ──────────────────────────────────────────────────────
// Newer than the monthly dump; its search also covers books added since.

type openLibraryLive struct{}

func (openLibraryLive) Name() string { return "openlibrary" }

type olDoc struct {
	Key              string   `json:"key"`
	Title            string   `json:"title"`
	Subtitle         string   `json:"subtitle"`
	AuthorName       []string `json:"author_name"`
	FirstPublishYear int      `json:"first_publish_year"`
	ISBN             []string `json:"isbn"`
	Publisher        []string `json:"publisher"`
	Language         []string `json:"language"`
	CoverI           int64    `json:"cover_i"`
	Subject          []string `json:"subject"`
	Pages            int      `json:"number_of_pages_median"`
	RatingsAverage   float64  `json:"ratings_average"`
	RatingsCount     int      `json:"ratings_count"`
	ReadingLogCount  int      `json:"readinglog_count"`
}

const olFields = "key,title,subtitle,author_name,first_publish_year,isbn,publisher,language,cover_i,subject,number_of_pages_median,ratings_average,ratings_count,readinglog_count"

func (o openLibraryLive) query(ctx context.Context, params url.Values) ([]liveRecord, error) {
	params.Set("fields", olFields)
	var res struct {
		Docs []olDoc `json:"docs"`
	}
	if err := getJSON(ctx, "https://openlibrary.org/search.json?"+params.Encode(), nil, &res); err != nil {
		return nil, err
	}
	var out []liveRecord
	for _, d := range res.Docs {
		r := liveRecord{
			Source: "live:openlibrary", ID: d.Key, Title: clean(d.Title), Subtitle: clean(d.Subtitle),
			Authors: cleanAll(d.AuthorName), Year: d.FirstPublishYear, Pages: d.Pages,
			Rating: d.RatingsAverage, Ratings: d.RatingsCount, Readers: d.ReadingLogCount,
			Genres: firstN(cleanAll(d.Subject), 12),
		}
		if len(d.Publisher) > 0 {
			r.Publisher = clean(d.Publisher[0])
		}
		if len(d.Language) > 0 {
			r.Language = d.Language[0]
		}
		if d.CoverI > 0 {
			r.Cover = coverURL(&d.CoverI)
		}
		r.ISBNs = normalizeAll(firstN(d.ISBN, 40))
		if r.Title != "" {
			out = append(out, r)
		}
	}
	return out, nil
}

func (o openLibraryLive) ByISBN(ctx context.Context, isbn string) ([]liveRecord, error) {
	return o.query(ctx, url.Values{"isbn": {isbn}, "limit": {"3"}})
}

func (o openLibraryLive) Search(ctx context.Context, q string, limit int) ([]liveRecord, error) {
	return o.query(ctx, url.Values{"q": {q}, "limit": {strconv.Itoa(limit)}})
}

// ── Google Books ────────────────────────────────────────────────────────────
// Broad, including small presses and other languages. Needs an API key.

type googleBooks struct{ key string }

func (googleBooks) Name() string { return "google" }

func (g googleBooks) query(ctx context.Context, q string, limit int) ([]liveRecord, error) {
	params := url.Values{"q": {q}, "maxResults": {strconv.Itoa(min(limit, 40))}, "printType": {"books"}, "key": {g.key}}
	var res struct {
		Items []struct {
			ID   string `json:"id"`
			Info struct {
				Title         string   `json:"title"`
				Subtitle      string   `json:"subtitle"`
				Authors       []string `json:"authors"`
				Publisher     string   `json:"publisher"`
				PublishedDate string   `json:"publishedDate"`
				Description   string   `json:"description"`
				PageCount     int      `json:"pageCount"`
				Categories    []string `json:"categories"`
				AverageRating float64  `json:"averageRating"`
				RatingsCount  int      `json:"ratingsCount"`
				Language      string   `json:"language"`
				ImageLinks    struct {
					Thumbnail string `json:"thumbnail"`
				} `json:"imageLinks"`
				Identifiers []struct {
					Type       string `json:"type"`
					Identifier string `json:"identifier"`
				} `json:"industryIdentifiers"`
			} `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := getJSON(ctx, "https://www.googleapis.com/books/v1/volumes?"+params.Encode(), nil, &res); err != nil {
		return nil, err
	}
	var out []liveRecord
	for _, item := range res.Items {
		v := item.Info
		r := liveRecord{
			Source: "live:google", ID: item.ID, Title: clean(v.Title), Subtitle: clean(v.Subtitle),
			Authors: cleanAll(v.Authors), Publisher: clean(v.Publisher), Year: yearOf(v.PublishedDate),
			Description: truncate(clean(v.Description), 8000), Pages: v.PageCount, Genres: cleanAll(v.Categories),
			Rating: v.AverageRating, Ratings: v.RatingsCount, Language: v.Language,
			Cover: strings.Replace(v.ImageLinks.Thumbnail, "http://", "https://", 1),
		}
		for _, id := range v.Identifiers {
			if isbn := normalizeISBN(id.Identifier); isbn != "" && strings.HasPrefix(id.Type, "ISBN") {
				r.ISBNs = append(r.ISBNs, isbn)
			}
		}
		if r.Title != "" {
			out = append(out, r)
		}
	}
	return out, nil
}

func (g googleBooks) ByISBN(ctx context.Context, isbn string) ([]liveRecord, error) {
	return g.query(ctx, "isbn:"+isbn, 3)
}

func (g googleBooks) Search(ctx context.Context, q string, limit int) ([]liveRecord, error) {
	return g.query(ctx, q, limit)
}

// ── Hardcover ───────────────────────────────────────────────────────────────
// Readers' ratings, how many people read a book, and its genres.

type hardcover struct{ token string }

func (hardcover) Name() string { return "hardcover" }

const hardcoverBookFields = `id title subtitle description release_year pages rating ratings_count users_count
	image { url } cached_contributors cached_tags`

type hcBook struct {
	ID           int                   `json:"id"`
	Title        string                `json:"title"`
	Subtitle     string                `json:"subtitle"`
	Description  string                `json:"description"`
	ReleaseYear  int                   `json:"release_year"`
	Pages        int                   `json:"pages"`
	Rating       float64               `json:"rating"`
	RatingsCount int                   `json:"ratings_count"`
	UsersCount   int                   `json:"users_count"`
	Image        *struct{ URL string } `json:"image"`
	Contributors json.RawMessage       `json:"cached_contributors"`
	Tags         json.RawMessage       `json:"cached_tags"`
}

func (h hardcover) graphql(ctx context.Context, query string, vars map[string]any, into any) error {
	var res struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	token := h.token
	if !strings.HasPrefix(strings.ToLower(token), "bearer ") {
		token = "Bearer " + token
	}
	if err := postJSON(ctx, "https://api.hardcover.app/v1/graphql", map[string]string{"Authorization": token},
		map[string]any{"query": query, "variables": vars}, &res); err != nil {
		return err
	}
	if len(res.Errors) > 0 {
		return fmt.Errorf("hardcover: %s", res.Errors[0].Message)
	}
	return json.Unmarshal(res.Data, into)
}

func (h hardcover) ByISBN(ctx context.Context, isbn string) ([]liveRecord, error) {
	var data struct {
		Editions []struct {
			Book hcBook `json:"book"`
		} `json:"editions"`
	}
	q := `query($isbn: String!) { editions(where: {isbn_13: {_eq: $isbn}}, limit: 1) { book { ` + hardcoverBookFields + ` } } }`
	if err := h.graphql(ctx, q, map[string]any{"isbn": isbn}, &data); err != nil {
		return nil, err
	}
	var out []liveRecord
	for _, e := range data.Editions {
		r := e.Book.record()
		r.ISBNs = []string{isbn}
		out = append(out, r)
	}
	return out, nil
}

// Search goes through Hardcover's own search (Typesense), most read first.
func (h hardcover) Search(ctx context.Context, q string, limit int) ([]liveRecord, error) {
	var data struct {
		Search struct {
			Results struct {
				Hits []struct {
					Document struct {
						ID           json.Number `json:"id"`
						Title        string      `json:"title"`
						Subtitle     string      `json:"subtitle"`
						Description  string      `json:"description"`
						AuthorNames  []string    `json:"author_names"`
						ISBNs        []string    `json:"isbns"`
						Genres       []string    `json:"genres"`
						ReleaseYear  int         `json:"release_year"`
						Pages        int         `json:"pages"`
						Rating       float64     `json:"rating"`
						RatingsCount int         `json:"ratings_count"`
						UsersCount   int         `json:"users_count"`
						Image        struct {
							URL string `json:"url"`
						} `json:"image"`
					} `json:"document"`
				} `json:"hits"`
			} `json:"results"`
		} `json:"search"`
	}
	query := `query($q: String!, $limit: Int!) { search(query: $q, query_type: "Book", per_page: $limit, page: 1) { results } }`
	if err := h.graphql(ctx, query, map[string]any{"q": q, "limit": limit}, &data); err != nil {
		return nil, err
	}
	var out []liveRecord
	for _, hit := range data.Search.Results.Hits {
		d := hit.Document
		r := liveRecord{
			Source: "live:hardcover", ID: d.ID.String(), Title: clean(d.Title), Subtitle: clean(d.Subtitle),
			Description: truncate(clean(d.Description), 8000), Authors: cleanAll(d.AuthorNames),
			ISBNs: normalizeAll(firstN(d.ISBNs, 40)), Genres: cleanAll(d.Genres), Year: d.ReleaseYear, Pages: d.Pages,
			Rating: d.Rating, Ratings: d.RatingsCount, Readers: d.UsersCount, Cover: d.Image.URL,
		}
		if r.Title != "" {
			out = append(out, r)
		}
	}
	return out, nil
}

func (b hcBook) record() liveRecord {
	r := liveRecord{
		Source: "live:hardcover", ID: strconv.Itoa(b.ID), Title: clean(b.Title), Subtitle: clean(b.Subtitle),
		Description: truncate(clean(b.Description), 8000), Year: b.ReleaseYear, Pages: b.Pages,
		Rating: b.Rating, Ratings: b.RatingsCount, Readers: b.UsersCount,
	}
	if b.Image != nil {
		r.Cover = b.Image.URL
	}
	// cached_contributors: [{"author": {"name": ...}}, ...]
	var contributors []struct {
		Author struct {
			Name string `json:"name"`
		} `json:"author"`
	}
	if json.Unmarshal(b.Contributors, &contributors) == nil {
		for _, c := range contributors {
			if c.Author.Name != "" {
				r.Authors = append(r.Authors, clean(c.Author.Name))
			}
		}
	}
	// cached_tags: {"Genre": [{"tag": "Fantasy"}, ...], "Mood": [...], ...}
	var tags map[string][]struct {
		Tag string `json:"tag"`
	}
	if json.Unmarshal(b.Tags, &tags) == nil {
		for _, t := range tags["Genre"] {
			if t.Tag != "" {
				r.Genres = append(r.Genres, clean(t.Tag))
			}
		}
	}
	return r
}

func firstN[T any](s []T, n int) []T {
	if len(s) > n {
		return s[:n]
	}
	return s
}

func normalizeAll(raw []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range raw {
		if isbn := normalizeISBN(s); isbn != "" && !seen[isbn] {
			seen[isbn] = true
			out = append(out, isbn)
		}
	}
	return out
}
