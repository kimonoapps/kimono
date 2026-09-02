package server

import "testing"

// Headscale prints a version notice on its own line before the payload, and
// encodes identifiers as strings. Both were observed on a running appliance.
func TestParseHeadscaleUsersSkipsTheVersionNotice(t *testing.T) {
	output := []byte(`{"level":"warn","time":1788319268,"message":"An updated version of Headscale has been found"}
[{"id":"1","name":"akadmin"},{"id":"2","name":"kimono-control-plane"}]`)
	users, err := parseHeadscaleUsers(output)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 || users[0].ID != 1 || users[0].Name != "akadmin" || users[1].ID != 2 || users[1].Name != controlPlaneUser {
		t.Fatalf("unexpected users: %#v", users)
	}
}

func TestParseHeadscaleUsersAcceptsNumericIdentifiers(t *testing.T) {
	users, err := parseHeadscaleUsers([]byte(`[{"id":7,"name":"kimono-control-plane"}]`))
	if err != nil || len(users) != 1 || users[0].ID != 7 {
		t.Fatalf("users=%#v err=%v", users, err)
	}
}

func TestParseHeadscaleUsersReportsAReplyItCannotRead(t *testing.T) {
	for name, output := range map[string]string{
		"no document": `{"level":"error","message":"connection refused"}`,
		"not a list":  `{"id":"1","name":"akadmin"}`,
	} {
		if _, err := parseHeadscaleUsers([]byte(output)); err == nil {
			t.Fatalf("%s: expected an error", name)
		}
	}
}
