package sandbox

import (
	"strings"
	"testing"
)

func TestOutboxReadsAccessRequests(t *testing.T) {
	out := "shot a.png\n" +
		`access 1730000000000-0a1b2c3d.json {"space":"Photos","path":"/2026/","need":"change","why":"To sort last week's pictures by day."}` + "\n" +
		`access 1730000000001-0a1b2c3e.json {"space":"Photos","need":"delete","why":"x"}` + "\n" +
		`access ../../etc.json {"space":"Photos","need":"read","why":"x"}` + "\n" +
		`access 1730000000002-0a1b2c3f.json {"space":"","need":"read","why":"x"}` + "\n"
	box := parseOutbox([]byte(out))
	if len(box.shots) != 1 {
		t.Fatalf("shots: %v", box.shots)
	}
	if len(box.access) != 1 {
		t.Fatalf("only the one well-formed request counts, got %+v", box.access)
	}
	got := box.access[0]
	if got.ID != "1730000000000-0a1b2c3d.json" || got.Space != "Photos" || got.Path != "2026" || got.Need != "change" || !strings.HasPrefix(got.Why, "To sort") {
		t.Fatalf("%+v", got)
	}
}

func TestAccessRequestsHaveLimits(t *testing.T) {
	long := strings.Repeat("x", 301)
	if _, ok := parseAccess("1-0a1b2c3d.json", `{"space":"Photos","need":"read","why":"`+long+`"}`); ok {
		t.Error("a reason over 300 characters must be refused")
	}
	if _, ok := parseAccess("1-0a1b2c3d.json", `not json`); ok {
		t.Error("not JSON must be refused")
	}
	if _, ok := parseAccess("1-0a1b2c3d.json", `{"space":"Photos","need":"read","why":"Look at the receipts."}`); !ok {
		t.Error("a plain request must be accepted")
	}
}

func TestCheckoutKeepsGrantedFilesOutOfGit(t *testing.T) {
	if !strings.Contains(checkoutScript, "/.kimono/") || !strings.Contains(checkoutScript, ".git/info/exclude") {
		t.Fatal("the checkout must exclude .kimono from git")
	}
	if !strings.Contains(grantedScript, ".kimono/files") {
		t.Fatal("the granted listing must look in .kimono/files")
	}
}
