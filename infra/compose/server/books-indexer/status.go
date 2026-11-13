package main

import (
	"log"
	"sync"
	"time"
)

const userAgent = "KimonoBooks/1.0 (+https://github.com/kimonoapps/kimono)"

func logf(format string, args ...any) { log.Printf(format, args...) }

// status is what /status reports: the job underway and how far it got.
type status struct {
	mu        sync.Mutex
	Phase     string    `json:"phase"`
	Done      int64     `json:"done,omitempty"`
	Total     int64     `json:"total,omitempty"`
	LastError string    `json:"lastError,omitempty"`
	ErrorAt   time.Time `json:"errorAt,omitzero"`
	Since     time.Time `json:"since"`
}

func (s *status) set(phase string, done, total int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Phase != phase {
		logf("%s", phase)
		s.Since = time.Now()
	}
	s.Phase, s.Done, s.Total = phase, done, total
}

func (s *status) progress(done, total int64) {
	s.mu.Lock()
	s.Done, s.Total = done, total
	s.mu.Unlock()
}

func (s *status) fail(err error) {
	logf("error: %v", err)
	s.mu.Lock()
	s.LastError, s.ErrorAt = err.Error(), time.Now()
	s.mu.Unlock()
}

func (s *status) snapshot() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]any{"phase": s.Phase, "since": s.Since}
	if s.Total > 0 {
		out["done"], out["total"] = s.Done, s.Total
	}
	if s.LastError != "" {
		out["lastError"], out["errorAt"] = s.LastError, s.ErrorAt
	}
	return out
}
