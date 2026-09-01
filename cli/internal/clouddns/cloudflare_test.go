package clouddns

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestUpsertARecordForcesDNSOnly(t *testing.T) {
	requests := 0
	transport := roundTripFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.Method == http.MethodGet {
			return jsonResponse(`{"success":true,"result":[{"id":"record-1","name":"mesh.example.com","content":"192.0.2.1","proxied":true}],"errors":[]}`), nil
		}
		if request.Method != http.MethodPatch {
			t.Fatalf("unexpected method %s", request.Method)
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["proxied"] != false || body["content"] != "203.0.113.10" {
			t.Fatalf("unexpected body: %#v", body)
		}
		return jsonResponse(`{"success":true,"result":{"id":"record-1"},"errors":[]}`), nil
	})
	client := NewClient("test-token")
	client.http.Transport = transport
	changed, err := client.UpsertA("zone-1", "mesh.example.com", "203.0.113.10")
	if err != nil {
		t.Fatal(err)
	}
	if !changed || requests != 2 {
		t.Fatalf("changed=%v requests=%d", changed, requests)
	}
}

func TestVerifyAccountTokenUsesAccountEndpoint(t *testing.T) {
	const accountID = "0123456789abcdef0123456789abcdef"
	client := NewClient("test-token")
	client.http.Transport = roundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/client/v4/accounts/"+accountID+"/tokens/verify" {
			t.Fatalf("unexpected verification path %s", request.URL.Path)
		}
		return jsonResponse(`{"success":true,"result":{"status":"active"},"errors":[]}`), nil
	})
	if err := client.VerifyToken(accountID); err != nil {
		t.Fatal(err)
	}
}

func jsonResponse(body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Status:     "200 OK",
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}
