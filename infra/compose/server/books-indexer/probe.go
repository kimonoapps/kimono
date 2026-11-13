package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
)

// probeSources asks each configured live source directly and prints what it
// answers, so a source (Anna's Archive's record address above all) can be
// checked on the server before people rely on it. Nothing is stored.
func probeSources(ctx context.Context, cfg config, query string) {
	l := &live{sources: []liveSource{openLibraryLive{}}}
	if cfg.GoogleKey != "" {
		l.sources = append(l.sources, googleBooks{key: cfg.GoogleKey})
	}
	if cfg.HardcoverToken != "" {
		l.sources = append(l.sources, hardcover{token: cfg.HardcoverToken})
	}
	if cfg.AABase != "" && cfg.AACookie != "" {
		l.sources = append(l.sources, annasLive{base: cfg.AABase, cookie: cfg.AACookie, path: cfg.AARecordPath})
	}
	isbn := normalizeISBN(query)
	out := json.NewEncoder(os.Stdout)
	out.SetIndent("", "  ")
	for _, s := range l.sources {
		var records []liveRecord
		var err error
		if isbn != "" {
			records, err = s.ByISBN(ctx, isbn)
		} else {
			records, err = s.Search(ctx, query, 5)
		}
		fmt.Printf("== %s: %d found", s.Name(), len(records))
		if err != nil {
			fmt.Printf(" (%v)", err)
		}
		fmt.Println()
		out.Encode(firstN(records, 3))
	}
}
