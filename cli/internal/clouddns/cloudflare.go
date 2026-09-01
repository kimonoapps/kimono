// Package clouddns talks to Cloudflare's DNS API. It is shared: the server
// manager keeps the appliance's own records current, and the reconciler points
// each directly published hostname at them.
package clouddns

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const cloudflareAPI = "https://api.cloudflare.com/client/v4"

type Config struct {
	Token     string   `json:"token"`
	AccountID string   `json:"account_id,omitempty"`
	ZoneID    string   `json:"zone_id"`
	ZoneName  string   `json:"zone_name"`
	Records   []string `json:"records"`
}

type Client struct {
	token   string
	baseURL string
	http    *http.Client
}

type apiResponse[T any] struct {
	Success bool `json:"success"`
	Result  T    `json:"result"`
	Errors  []struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"errors"`
}

type Zone struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type dnsRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content"`
	Proxied bool   `json:"proxied"`
}

func NewClient(token string) *Client {
	return &Client{token: token, baseURL: cloudflareAPI, http: &http.Client{Timeout: 20 * time.Second}}
}

func (c *Client) VerifyToken(accountID string) error {
	var result struct {
		Status string `json:"status"`
	}
	path := "/user/tokens/verify"
	if accountID != "" {
		path = "/accounts/" + url.PathEscape(accountID) + "/tokens/verify"
	}
	if err := c.request(http.MethodGet, path, nil, &result); err != nil {
		return err
	}
	if result.Status != "active" {
		return fmt.Errorf("token status is %q", result.Status)
	}
	return nil
}

func (c *Client) FindZone(hostname, requested, accountID string) (Zone, error) {
	candidates := []string{}
	if requested != "" {
		candidates = append(candidates, strings.Trim(requested, "."))
	} else {
		labels := strings.Split(strings.Trim(hostname, "."), ".")
		for index := 1; index < len(labels)-1; index++ {
			candidates = append(candidates, strings.Join(labels[index:], "."))
		}
	}
	for _, candidate := range candidates {
		var zones []Zone
		query := url.Values{"name": []string{candidate}}
		if accountID != "" {
			query.Set("account.id", accountID)
		}
		if err := c.request(http.MethodGet, "/zones?"+query.Encode(), nil, &zones); err != nil {
			return Zone{}, err
		}
		if len(zones) == 1 {
			return zones[0], nil
		}
	}
	return Zone{}, errors.New("could not find the Cloudflare zone; ensure the token has Zone:Read and use --zone if needed")
}

func (c *Client) UpsertA(zoneID, name, address string) (bool, error) {
	path := fmt.Sprintf("/zones/%s/dns_records?type=A&name=%s", url.PathEscape(zoneID), url.QueryEscape(name))
	var records []dnsRecord
	if err := c.request(http.MethodGet, path, nil, &records); err != nil {
		return false, err
	}
	body := map[string]any{"type": "A", "name": name, "content": address, "ttl": 1, "proxied": false, "comment": "Managed by Kimono Dynamic DNS"}
	if len(records) == 0 {
		var created dnsRecord
		return true, c.request(http.MethodPost, fmt.Sprintf("/zones/%s/dns_records", url.PathEscape(zoneID)), body, &created)
	}
	record := records[0]
	if record.Content == address && !record.Proxied {
		return false, nil
	}
	var updated dnsRecord
	path = fmt.Sprintf("/zones/%s/dns_records/%s", url.PathEscape(zoneID), url.PathEscape(record.ID))
	return true, c.request(http.MethodPatch, path, body, &updated)
}

func (c *Client) request(method, path string, body any, result any) error {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(data)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return err
	}
	var envelope apiResponse[json.RawMessage]
	if err := json.Unmarshal(data, &envelope); err != nil {
		return fmt.Errorf("Cloudflare returned %s: %w", response.Status, err)
	}
	if !envelope.Success || response.StatusCode < 200 || response.StatusCode >= 300 {
		messages := make([]string, 0, len(envelope.Errors))
		for _, apiErr := range envelope.Errors {
			messages = append(messages, fmt.Sprintf("%d: %s", apiErr.Code, apiErr.Message))
		}
		return fmt.Errorf("Cloudflare API %s: %s", response.Status, strings.Join(messages, "; "))
	}
	if result != nil {
		if err := json.Unmarshal(envelope.Result, result); err != nil {
			return err
		}
	}
	return nil
}

// UpsertCNAME points a published hostname at the address the appliance already
// answers on. The record stays DNS-only: the appliance terminates TLS itself,
// and a proxied record would hide the origin its certificate is issued against.
func (c *Client) UpsertCNAME(zoneID, name, target string) (bool, error) {
	path := fmt.Sprintf("/zones/%s/dns_records?type=CNAME&name=%s", url.PathEscape(zoneID), url.QueryEscape(name))
	var records []dnsRecord
	if err := c.request(http.MethodGet, path, nil, &records); err != nil {
		return false, err
	}
	body := map[string]any{"type": "CNAME", "name": name, "content": target, "ttl": 1, "proxied": false, "comment": "Managed by Kimono"}
	if len(records) == 0 {
		var created dnsRecord
		return true, c.request(http.MethodPost, fmt.Sprintf("/zones/%s/dns_records", url.PathEscape(zoneID)), body, &created)
	}
	existing := records[0]
	if strings.EqualFold(strings.TrimSuffix(existing.Content, "."), strings.TrimSuffix(target, ".")) && !existing.Proxied {
		return false, nil
	}
	var updated dnsRecord
	path = fmt.Sprintf("/zones/%s/dns_records/%s", url.PathEscape(zoneID), url.PathEscape(existing.ID))
	return true, c.request(http.MethodPatch, path, body, &updated)
}

// LoadConfig reads the Dynamic DNS credentials the appliance already stores.
func LoadConfig(path string) (Config, error) {
	var config Config
	data, err := os.ReadFile(path)
	if err != nil {
		return config, err
	}
	if err := json.Unmarshal(data, &config); err != nil {
		return config, fmt.Errorf("%s is not valid JSON: %w", path, err)
	}
	if config.Token == "" || config.ZoneID == "" {
		return config, errors.New("Dynamic DNS is not configured; run `sudo kimono server cloudflare-ddns setup`")
	}
	return config, nil
}
