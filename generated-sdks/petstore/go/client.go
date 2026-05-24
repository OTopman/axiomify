package axiomifysdkgo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

type Client struct {
	BaseURL string
	HTTPClient *http.Client
	Token string
}

func NewClient(baseURL string) *Client {
	return &Client{BaseURL: baseURL, HTTPClient: &http.Client{}}
}

func (c *Client) ListPets(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/pets"
	httpReq, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil { return nil, err }

	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API Error: %d", resp.StatusCode)
	}

	return nil, nil
}

