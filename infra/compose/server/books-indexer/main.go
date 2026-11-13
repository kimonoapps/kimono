package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	DatabaseURL, Key, Dir, PortalURL, AATorrentsURL string
	AAGroups                                        []string
	Every                                           time.Duration
	// Live lookups (live.go): each source is used only when it is set up.
	GoogleKey, HardcoverToken      string
	AABase, AACookie, AARecordPath string
	OpenLibraryDump                bool
}

func env(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func loadConfig() config {
	hours, _ := strconv.Atoi(env("KIMONO_BOOKS_CHECK_HOURS", "24"))
	var groups []string
	for _, g := range strings.Split(env("KIMONO_BOOKS_AA_GROUPS", ""), ",") {
		if g = strings.TrimSpace(g); g != "" {
			groups = append(groups, g)
		}
	}
	return config{
		DatabaseURL: env("KIMONO_BOOKS_DATABASE_URL", ""),
		Key:         env("KIMONO_BOOKS_KEY", ""),
		Dir:         env("KIMONO_BOOKS_DIR", "/var/lib/kimono-books"),
		PortalURL:   strings.TrimRight(env("KIMONO_PORTAL_URL", "http://portal:3000"), "/"),
		// Anna's Archive moves between domains; set this when it does. Empty
		// leaves Anna's Archive out.
		AATorrentsURL:  env("KIMONO_BOOKS_AA_TORRENTS_URL", ""),
		AAGroups:       groups,
		Every:          time.Duration(max(hours, 1)) * time.Hour,
		GoogleKey:      env("KIMONO_BOOKS_GOOGLE_KEY", ""),
		HardcoverToken: env("KIMONO_BOOKS_HARDCOVER_TOKEN", ""),
		// A member's session cookie for Anna's Archive, so its pages answer
		// without bot checks. The path is where it serves an ISBN's record as JSON.
		AABase:       strings.TrimRight(env("KIMONO_BOOKS_AA_BASE", ""), "/"),
		AACookie:     env("KIMONO_BOOKS_AA_COOKIE", ""),
		AARecordPath: env("KIMONO_BOOKS_AA_RECORD_PATH", "/db/aarecord_elasticsearch/isbndb:{isbn}.json"),
		// The Open Library dump is a fast local base; off, the catalog grows
		// only from what people look up.
		OpenLibraryDump: env("KIMONO_BOOKS_OPENLIBRARY_DUMP", "on") == "on",
	}
}

func main() {
	once := flag.Bool("once", false, "check every source once, then exit")
	list := flag.Bool("list", false, "list Anna's Archive metadata collections and exit")
	probe := flag.String("probe", "", "ask every live source about an ISBN (or a search) and print what each answers")
	flag.Parse()
	cfg := loadConfig()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if *list {
		if err := listCollections(ctx, cfg); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if *probe != "" {
		probeSources(ctx, cfg, *probe)
		return
	}
	if cfg.DatabaseURL == "" || cfg.Key == "" {
		fmt.Fprintln(os.Stderr, "KIMONO_BOOKS_DATABASE_URL and KIMONO_BOOKS_KEY are required")
		os.Exit(2)
	}
	pool, err := connect(ctx, cfg.DatabaseURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	defer pool.Close()
	st := &status{Phase: "starting", Since: time.Now()}
	lv, err := newLive(ctx, pool, cfg)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	if *once {
		cycle(ctx, pool, cfg, st)
		return
	}
	go lv.heal(ctx)
	server := &http.Server{Addr: ":8080", Handler: routes(pool, lv, cfg, st), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdown)
	}()
	go func() {
		for {
			cycle(ctx, pool, cfg, st)
			select {
			case <-time.After(cfg.Every):
			case <-ctx.Done():
				return
			}
		}
	}()
	logf("listening on :8080")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

// connect waits for Postgres, which may still be starting beside it.
func connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	for attempt := 0; ; attempt++ {
		if err = pool.Ping(ctx); err == nil {
			return pool, nil
		}
		if attempt == 30 || ctx.Err() != nil {
			pool.Close()
			return nil, fmt.Errorf("database: %w", err)
		}
		time.Sleep(2 * time.Second)
	}
}

// cycle brings every source up to date, one at a time.
func cycle(ctx context.Context, pool *pgxpool.Pool, cfg config, st *status) {
	if cfg.OpenLibraryDump {
		if err := syncOpenLibrary(ctx, pool, cfg, st); err != nil && ctx.Err() == nil {
			st.fail(fmt.Errorf("Open Library: %w", err))
		}
	}
	if cfg.AATorrentsURL != "" {
		if err := syncAnnasArchive(ctx, pool, cfg, st); err != nil && ctx.Err() == nil {
			st.fail(fmt.Errorf("Anna's Archive: %w", err))
		}
	}
	st.set("idle", 0, 0)
}

func syncOpenLibrary(ctx context.Context, pool *pgxpool.Pool, cfg config, st *status) error {
	st.set("checking Open Library", 0, 0)
	have, err := lastImport(ctx, pool)
	if err != nil {
		return err
	}
	dumps := map[string]remoteDump{}
	for _, kind := range openLibraryDumps {
		d, err := resolveLatest(ctx, kind)
		if err != nil {
			return err
		}
		dumps[kind] = d
	}
	date := dumps["editions"].Date
	if date <= have {
		return nil
	}
	dir := filepath.Join(cfg.Dir, "dumps", "openlibrary")
	files, keep := map[string]string{}, map[string]bool{}
	for _, kind := range openLibraryDumps {
		st.set("downloading Open Library "+kind, 0, dumps[kind].Size)
		file, err := fetch(ctx, dumps[kind], dir, st.progress)
		if err != nil {
			return err
		}
		files[kind], keep[dumps[kind].Name] = file, true
	}
	counts, err := importOpenLibrary(ctx, pool, date, files, st)
	if err != nil {
		return err
	}
	logf("Open Library %s: %d authors, %d works, %d editions", date, counts.Authors, counts.Works, counts.Editions)
	pruneDumps(dir, keep)
	return nil
}

func syncAnnasArchive(ctx context.Context, pool *pgxpool.Pool, cfg config, st *status) error {
	st.set("checking Anna's Archive", 0, 0)
	list, err := aaTorrents(ctx, cfg.AATorrentsURL)
	if err != nil {
		return err
	}
	groups := aaGroups(list, cfg.AAGroups)
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		have, err := lastImportOf(ctx, pool, "aa:"+name)
		if err != nil {
			return err
		}
		if have == aaVersion(groups[name]) {
			continue
		}
		if err := importAACollection(ctx, pool, cfg, name, groups[name], st); err != nil {
			if ctx.Err() != nil {
				return err
			}
			st.fail(fmt.Errorf("Anna's Archive %s: %w", name, err))
		}
	}
	return nil
}

func listCollections(ctx context.Context, cfg config) error {
	if cfg.AATorrentsURL == "" {
		return fmt.Errorf("set KIMONO_BOOKS_AA_TORRENTS_URL to Anna's Archive's /dyn/torrents.json")
	}
	list, err := aaTorrents(ctx, cfg.AATorrentsURL)
	if err != nil {
		return err
	}
	groups := aaGroups(list, cfg.AAGroups)
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		var size int64
		for _, t := range groups[name] {
			size += t.DataSize
		}
		fmt.Printf("%-40s %4d torrents %8.1f GB\n", name, len(groups[name]), float64(size)/1e9)
	}
	return nil
}

func routes(pool *pgxpool.Pool, lv *live, cfg config, st *status) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	authed := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			given := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(given), []byte(cfg.Key)) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("GET /status", authed(func(w http.ResponseWriter, r *http.Request) {
		out := st.snapshot()
		rows, err := pool.Query(r.Context(), "SELECT DISTINCT ON (source) source, dump_date, finished_at, works + editions FROM public.book_imports ORDER BY source, id DESC")
		if err == nil {
			var imports []map[string]any
			for rows.Next() {
				var source, date string
				var at time.Time
				var n int64
				if rows.Scan(&source, &date, &at, &n) == nil {
					imports = append(imports, map[string]any{"source": source, "version": date, "finishedAt": at, "records": n})
				}
			}
			rows.Close()
			out["imports"] = imports
		}
		writeJSON(w, out)
	}))
	mux.HandleFunc("GET /search", authed(func(w http.ResponseWriter, r *http.Request) {
		q := strings.TrimSpace(r.URL.Query().Get("q"))
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		if q == "" {
			http.Error(w, "q is required", http.StatusBadRequest)
			return
		}
		if isbn := normalizeISBN(q); isbn != "" {
			books, err := lookupISBN(r.Context(), pool, lv, isbn)
			respond(w, map[string]any{"books": books}, err)
			return
		}
		books, err := searchAll(r.Context(), pool, lv, q, min(max(limit, 1), 50))
		respond(w, map[string]any{"books": books}, err)
	}))
	mux.HandleFunc("GET /isbn/{isbn}", authed(func(w http.ResponseWriter, r *http.Request) {
		isbn := normalizeISBN(r.PathValue("isbn"))
		if isbn == "" {
			http.Error(w, "not an ISBN", http.StatusBadRequest)
			return
		}
		books, err := lookupISBN(r.Context(), pool, lv, isbn)
		respond(w, map[string]any{"books": books}, err)
	}))
	return mux
}

func respond(w http.ResponseWriter, body any, err error) {
	if err != nil {
		logf("query: %v", err)
		http.Error(w, "the catalog is not ready", http.StatusServiceUnavailable)
		return
	}
	writeJSON(w, body)
}

func writeJSON(w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(body)
}
