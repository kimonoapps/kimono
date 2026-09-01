package server

import "testing"

func TestValidCloudflareID(t *testing.T) {
	if !validCloudflareID("0123456789abcdef0123456789ABCDEF") {
		t.Fatal("expected valid account ID")
	}
	for _, value := range []string{"", "short", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"} {
		if validCloudflareID(value) {
			t.Fatalf("expected %q to be invalid", value)
		}
	}
}
