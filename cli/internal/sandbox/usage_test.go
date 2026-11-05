package sandbox

import (
	"math"
	"net/http"
	"testing"
)

func headers(fiveHour, fiveReset, week, weekReset string) http.Header {
	h := http.Header{}
	if fiveHour != "" {
		h.Set("anthropic-ratelimit-unified-5h-utilization", fiveHour)
		h.Set("anthropic-ratelimit-unified-5h-reset", fiveReset)
	}
	if week != "" {
		h.Set("anthropic-ratelimit-unified-7d-utilization", week)
		h.Set("anthropic-ratelimit-unified-7d-reset", weekReset)
	}
	return h
}

func near(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestUsageIsCreditedToTheWorkspaceThatMadeTheRequest(t *testing.T) {
	var m meter
	m.credit("a", readUsage(headers("0.10", "100", "0.20", "900"))) // first reading: a baseline, nobody's
	m.credit("a", readUsage(headers("0.15", "100", "0.21", "900")))
	m.credit("b", readUsage(headers("0.25", "100", "0.23", "900")))
	m.credit("a", readUsage(headers("0.24", "100", "0.23", "900"))) // fell: counts as nothing
	a, five, week := m.take("a")
	b, _, _ := m.take("b")
	if !near(a.FiveHour, .05) || !near(a.Week, .01) || !near(b.FiveHour, .10) || !near(b.Week, .02) {
		t.Fatalf("a=%+v b=%+v", a, b)
	}
	if five.Utilization != .24 || week.Reset != 900 {
		t.Fatalf("last reading %+v %+v", five, week)
	}
	if again, _, _ := m.take("a"); again.FiveHour != 0 {
		t.Fatalf("take should start again from zero, got %+v", again)
	}
}

func TestANewWindowCreditsWhatItHasUsedSoFar(t *testing.T) {
	var m meter
	m.credit("a", readUsage(headers("0.90", "100", "", "")))
	m.credit("a", readUsage(headers("0.03", "200", "", "")))
	if got, _, _ := m.take("a"); !near(got.FiveHour, .03) {
		t.Fatalf("got %+v", got)
	}
}

func TestMissingOrOddUsageHeadersCountForNothing(t *testing.T) {
	var m meter
	m.credit("a", readUsage(http.Header{}))
	m.credit("a", readUsage(headers("lots", "100", "-1", "900")))
	if got, five, week := m.take("a"); got.FiveHour != 0 || got.Week != 0 || five != nil || week != nil {
		t.Fatalf("got %+v %v %v", got, five, week)
	}
}
