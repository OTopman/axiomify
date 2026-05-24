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

func (c *Client) GetAssetsAll(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/assets/*"
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

func (c *Client) GetGraphql(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/graphql"
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

func (c *Client) PostGraphql(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/graphql"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", reqURL, nil)
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

func (c *Client) GetGraphqlPlayground(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/graphql/playground"
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

type PostApiUsersRequest struct {
	Body interface{}
}

func (c *Client) PostApiUsers(ctx context.Context, req *PostApiUsersRequest) (*interface{}, error) {
	reqURL := c.BaseURL + "/api/users"
	bodyBytes, err := json.Marshal(req.Body)
	if err != nil { return nil, err }
	httpReq, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(bodyBytes))
	if err != nil { return nil, err }

	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API Error: %d", resp.StatusCode)
	}

	return nil, nil
}

type PostApiUsersAvatarRequest struct {
	Body interface{}
}

func (c *Client) PostApiUsersAvatar(ctx context.Context, req *PostApiUsersAvatarRequest) (*interface{}, error) {
	reqURL := c.BaseURL + "/api/users/avatar"
	bodyBytes, err := json.Marshal(req.Body)
	if err != nil { return nil, err }
	httpReq, err := http.NewRequestWithContext(ctx, "POST", reqURL, bytes.NewReader(bodyBytes))
	if err != nil { return nil, err }

	if c.Token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+c.Token)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(httpReq)
	if err != nil { return nil, err }
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API Error: %d", resp.StatusCode)
	}

	return nil, nil
}

func (c *Client) GetApiSecure-data(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/api/secure-data"
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

func (c *Client) GetProtectedData(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/protected/data"
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

func (c *Client) GetPing(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/ping"
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

func (c *Client) GetApiLogin(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/api/login"
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

func (c *Client) GetDownload(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/download"
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

func (c *Client) GetLive-feed(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/live-feed"
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

func (c *Client) GetDocsOpenapi.json(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/docs/openapi.json"
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

func (c *Client) GetDocs(ctx context.Context) (*interface{}, error) {
	reqURL := c.BaseURL + "/docs"
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

