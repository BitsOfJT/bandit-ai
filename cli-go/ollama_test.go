package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestVerifyOllama_ReturnsModelNames(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/tags" {
			w.Write([]byte(`{"models":[{"name":"gemma4:e2b"},{"name":"llama3"}]}`))
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	models, err := verifyOllama()
	if err != nil {
		t.Fatalf("verifyOllama returned error: %v", err)
	}
	if len(models) != 2 {
		t.Fatalf("expected 2 models, got %d", len(models))
	}
	if models[0] != "gemma4:e2b" {
		t.Errorf("expected first model to be 'gemma4:e2b', got %q", models[0])
	}
	if models[1] != "llama3" {
		t.Errorf("expected second model to be 'llama3', got %q", models[1])
	}
}

func TestVerifyOllama_Non200Status(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	_, err := verifyOllama()
	if err == nil {
		t.Fatal("expected error for non-200 status, got nil")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("expected error to mention status code 500, got: %v", err)
	}
}

func TestVerifyOllama_ConnectionRefused(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	_, err := verifyOllama()
	if err == nil {
		t.Fatal("expected error for connection refused, got nil")
	}
}

func TestChatStream_AccumulatesTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/chat" && r.Method == http.MethodPost {
			lines := []string{
				`{"message":{"role":"assistant","content":"Hello "}}`,
				`{"message":{"role":"assistant","content":"World!"}}`,
				`{"message":{"role":"assistant","content":""},"done":true}`,
			}
			for _, line := range lines {
				fmt.Fprintln(w, line)
			}
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	session := &Session{
		Model:       "gemma4:e2b",
		Messages:    []Message{{Role: "user", Content: "hello"}},
		Temperature: 0.7,
		TopP:        0.9,
		NumCtx:      2048,
	}
	formatter := NewMarkdownFormatter()

	out := captureStdout(func() {
		accumulated, err := chatStream(ctx, session, formatter)
		if err != nil {
			t.Fatalf("chatStream returned error: %v", err)
		}
		if accumulated != "Hello World!" {
			t.Errorf("expected accumulated text %q, got %q", "Hello World!", accumulated)
		}
	})

	if !strings.Contains(out, "Hello ") {
		t.Error("expected stdout to contain Hello ")
	}
	if !strings.Contains(out, "World!") {
		t.Error("expected stdout to contain World!")
	}
}

func TestChatStream_ReturnsAccumulatedText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/chat" && r.Method == http.MethodPost {
			fmt.Fprintln(w, `{"message":{"role":"assistant","content":"Final answer"}}`)
			fmt.Fprintln(w, `{"message":{"role":"assistant","content":""},"done":true}`)
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	session := &Session{
		Model:       "test-model",
		Messages:    []Message{{Role: "user", Content: "test"}},
		Temperature: 0.7,
		TopP:        0.9,
		NumCtx:      2048,
	}
	formatter := NewMarkdownFormatter()

	accumulated, err := chatStream(ctx, session, formatter)
	if err != nil {
		t.Fatalf("chatStream returned error: %v", err)
	}
	if accumulated != "Final answer" {
		t.Errorf("expected %q, got %q", "Final answer", accumulated)
	}
}

func TestChatStream_HttpError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	session := &Session{
		Model:       "test-model",
		Messages:    []Message{{Role: "user", Content: "test"}},
		Temperature: 0.7,
		TopP:        0.9,
		NumCtx:      2048,
	}
	formatter := NewMarkdownFormatter()

	_, err := chatStream(ctx, session, formatter)
	if err == nil {
		t.Fatal("expected error for 400 status, got nil")
	}
	if !strings.Contains(err.Error(), "400") {
		t.Errorf("expected error to mention 400, got: %v", err)
	}
}

func TestPullModel_ReportsProgress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/pull" && r.Method == http.MethodPost {
			lines := []PullResponse{
				{Status: "pulling manifest"},
				{Status: "downloading", Completed: 50, Total: 100},
				{Status: "downloading", Completed: 100, Total: 100},
				{Status: "success"},
			}
			for _, line := range lines {
				data, _ := json.Marshal(line)
				fmt.Fprintln(w, string(data))
			}
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	out := captureStdout(func() {
		err := pullModel(ctx, "test-model")
		if err != nil {
			t.Fatalf("pullModel returned error: %v", err)
		}
	})

	if !strings.Contains(out, "successfully installed") {
		t.Error("expected pull to report successful installation")
	}
	if !strings.Contains(out, "Downloading") {
		t.Error("expected pull to show download progress")
	}
}

func TestPullModel_ReturnsNilOnSuccess(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/pull" && r.Method == http.MethodPost {
			fmt.Fprintln(w, `{"status":"success"}`)
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	err := pullModel(ctx, "test-model")
	if err != nil {
		t.Fatalf("pullModel returned error: %v", err)
	}
}

func TestPullModel_HttpError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	err := pullModel(ctx, "test-model")
	if err == nil {
		t.Fatal("expected error for 404 status, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("expected error to mention 404, got: %v", err)
	}
}

// Test that pullModel sends the correct request body
func TestPullModel_SendsCorrectRequestBody(t *testing.T) {
	var reqBody PullRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/pull" && r.Method == http.MethodPost {
			json.NewDecoder(r.Body).Decode(&reqBody)
			fmt.Fprintln(w, `{"status":"success"}`)
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	pullModel(ctx, "my-model:latest")

	if reqBody.Name != "my-model:latest" {
		t.Errorf("expected model name 'my-model:latest', got %q", reqBody.Name)
	}
	if !reqBody.Stream {
		t.Error("expected Stream to be true")
	}
}

// Test that chatStream sends the correct messages in the request body
func TestChatStream_SendsCorrectRequestBody(t *testing.T) {
	var reqBody ChatRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/chat" && r.Method == http.MethodPost {
			bodyBytes, _ := io.ReadAll(r.Body)
			json.Unmarshal(bodyBytes, &reqBody)
			fmt.Fprintln(w, `{"message":{"role":"assistant","content":"ok"},"done":true}`)
		}
	}))
	defer server.Close()

	oldHost := OllamaHost
	OllamaHost = server.URL
	defer func() { OllamaHost = oldHost }()

	ctx := context.Background()
	msgs := []Message{
		{Role: "system", Content: "You are a helpful assistant."},
		{Role: "user", Content: "hello"},
	}
	session := &Session{
		Model:       "llama3",
		Messages:    msgs,
		Temperature: 0.5,
		TopP:        0.8,
		NumCtx:      4096,
	}
	formatter := NewMarkdownFormatter()

	chatStream(ctx, session, formatter)

	if reqBody.Model != "llama3" {
		t.Errorf("expected model 'llama3', got %q", reqBody.Model)
	}
	if len(reqBody.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(reqBody.Messages))
	}
	if reqBody.Messages[0].Content != "You are a helpful assistant." {
		t.Errorf("expected first message content to match")
	}
	if reqBody.Options.Temperature != 0.5 {
		t.Errorf("expected temperature 0.5, got %f", reqBody.Options.Temperature)
	}
	if reqBody.Options.TopP != 0.8 {
		t.Errorf("expected top_p 0.8, got %f", reqBody.Options.TopP)
	}
	if reqBody.Options.NumCtx != 4096 {
		t.Errorf("expected num_ctx 4096, got %d", reqBody.Options.NumCtx)
	}
}