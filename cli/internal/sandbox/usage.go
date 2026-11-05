package sandbox

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

/*
 * Usage, as the plan behind Kimono's Claude credential reports it. Each model
 * response through the gateway carries the account's place in its 5-hour and
 * weekly windows (anthropic-ratelimit-unified-5h-* and -7d-*: a utilization
 * from 0 to 1 and a reset time). These headers are not documented, so they are
 * read defensively: a missing or odd value is simply not counted.
 *
 * Every rise between one response and the next is credited to the workspace
 * that made the request, and the turn reports what it was credited when it
 * ends, so the Portal can hold each person to their share. Two workspaces
 * talking at once blur the split a little; the account total stays exact.
 */

type usageWindow struct {
	Utilization float64 `json:"utilization"`
	Reset       int64   `json:"reset"` // Unix seconds
}

// usageReading is one response's view of the account.
type usageReading struct {
	FiveHour, Week *usageWindow
}

func readUsage(header http.Header) usageReading {
	window := func(name string) *usageWindow {
		raw := header.Get("anthropic-ratelimit-unified-" + name + "-utilization")
		if raw == "" {
			return nil
		}
		u, err := strconv.ParseFloat(raw, 64)
		if err != nil || u < 0 || u > 10 {
			return nil
		}
		reset, _ := strconv.ParseInt(header.Get("anthropic-ratelimit-unified-"+name+"-reset"), 10, 64)
		return &usageWindow{Utilization: u, Reset: reset}
	}
	return usageReading{FiveHour: window("5h"), Week: window("7d")}
}

// meter keeps the account's last reading and what each workspace has been credited this turn.
type meter struct {
	mu       sync.Mutex
	fiveHour *usageWindow
	week     *usageWindow
	credited map[string]*usageCredit
}

type usageCredit struct {
	FiveHour float64
	Week     float64
}

// credit records a reading for a workspace and returns how much of each window it used.
func (m *meter) credit(id string, reading usageReading) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.credited == nil {
		m.credited = map[string]*usageCredit{}
	}
	c := m.credited[id]
	if c == nil {
		c = &usageCredit{}
		m.credited[id] = c
	}
	c.FiveHour += rise(&m.fiveHour, reading.FiveHour)
	c.Week += rise(&m.week, reading.Week)
}

// rise is how far a window moved since the last reading: all of it after a reset, nothing if it fell.
func rise(last **usageWindow, now *usageWindow) float64 {
	if now == nil {
		return 0
	}
	before := *last
	copied := *now
	*last = &copied
	if before == nil {
		return 0
	}
	if now.Reset != before.Reset {
		return now.Utilization
	}
	if now.Utilization > before.Utilization {
		return now.Utilization - before.Utilization
	}
	return 0
}

// take hands back what a workspace was credited and starts it again from zero.
func (m *meter) take(id string) (usageCredit, *usageWindow, *usageWindow) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var got usageCredit
	if c := m.credited[id]; c != nil {
		got = *c
		delete(m.credited, id)
	}
	return got, m.fiveHour, m.week
}

// usageLine is what a turn reports when it ends.
func usageLine(credit usageCredit, fiveHour, week *usageWindow) map[string]any {
	line := map[string]any{"type": "kimono.usage", "five_hour": credit.FiveHour, "week": credit.Week, "at": time.Now().UnixMilli()}
	if fiveHour != nil {
		line["five_hour_now"], line["five_hour_reset"] = fiveHour.Utilization, fiveHour.Reset
	}
	if week != nil {
		line["week_now"], line["week_reset"] = week.Utilization, week.Reset
	}
	return line
}
