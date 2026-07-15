package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// tempSessionDir replaces getSessionsDir and ensureSessionsDir with a temp dir.
// Returns the temp dir path and a cleanup function.
func tempSessionDir(t *testing.T) (string, func()) {
	t.Helper()
	dir, err := os.MkdirTemp("", "bandit-session-test-*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}

	// Save originals
	origGetSessionsDir := getSessionsDir
	origEnsureSessionsDir := ensureSessionsDir

	// Override
	getSessionsDir = func() (string, error) {
		return dir, nil
	}
	ensureSessionsDir = func() (string, error) {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return "", err
		}
		return dir, nil
	}

	cleanup := func() {
		getSessionsDir = origGetSessionsDir
		ensureSessionsDir = origEnsureSessionsDir
		os.RemoveAll(dir)
	}

	return dir, cleanup
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	s := &Session{
		ID:           "test-session-1",
		Title:        "Test Session",
		Messages:     []Message{{Role: "user", Content: "hello"}, {Role: "assistant", Content: "hi there"}},
		SystemPrompt: "You are a helpful assistant.",
		Model:        "llama3",
		Temperature:  0.7,
		TopP:         0.9,
		NumCtx:       4096,
		CreatedAt:    time.Now().UnixMilli(),
	}

	if err := saveSession(s); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	loaded, err := loadSession("test-session-1")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}

	if loaded.ID != s.ID {
		t.Errorf("ID: expected %q, got %q", s.ID, loaded.ID)
	}
	if loaded.Title != s.Title {
		t.Errorf("Title: expected %q, got %q", s.Title, loaded.Title)
	}
	if len(loaded.Messages) != len(s.Messages) {
		t.Fatalf("Messages length: expected %d, got %d", len(s.Messages), len(loaded.Messages))
	}
	if loaded.Messages[0].Content != s.Messages[0].Content {
		t.Errorf("Message[0].Content: expected %q, got %q", s.Messages[0].Content, loaded.Messages[0].Content)
	}
	if loaded.Messages[1].Content != s.Messages[1].Content {
		t.Errorf("Message[1].Content: expected %q, got %q", s.Messages[1].Content, loaded.Messages[1].Content)
	}
	if loaded.SystemPrompt != s.SystemPrompt {
		t.Errorf("SystemPrompt: expected %q, got %q", s.SystemPrompt, loaded.SystemPrompt)
	}
	if loaded.Model != s.Model {
		t.Errorf("Model: expected %q, got %q", s.Model, loaded.Model)
	}
	if loaded.Temperature != s.Temperature {
		t.Errorf("Temperature: expected %f, got %f", s.Temperature, loaded.Temperature)
	}
	if loaded.TopP != s.TopP {
		t.Errorf("TopP: expected %f, got %f", s.TopP, loaded.TopP)
	}
	if loaded.NumCtx != s.NumCtx {
		t.Errorf("NumCtx: expected %d, got %d", s.NumCtx, loaded.NumCtx)
	}
	if loaded.CreatedAt != s.CreatedAt {
		t.Errorf("CreatedAt: expected %d, got %d", s.CreatedAt, loaded.CreatedAt)
	}
}

func TestListSessions_SortedByCreatedAtDesc(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	sessions := []*Session{
		{ID: "oldest", Title: "Oldest", Messages: []Message{}, CreatedAt: now - 2000},
		{ID: "middle", Title: "Middle", Messages: []Message{}, CreatedAt: now - 1000},
		{ID: "newest", Title: "Newest", Messages: []Message{}, CreatedAt: now},
	}

	for _, s := range sessions {
		if err := saveSession(s); err != nil {
			t.Fatalf("saveSession(%q) failed: %v", s.ID, err)
		}
	}

	listed, err := listSessions()
	if err != nil {
		t.Fatalf("listSessions failed: %v", err)
	}

	if len(listed) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(listed))
	}

	// Should be sorted by CreatedAt descending
	if listed[0].ID != "newest" {
		t.Errorf("expected first session to be 'newest', got %q", listed[0].ID)
	}
	if listed[1].ID != "middle" {
		t.Errorf("expected second session to be 'middle', got %q", listed[1].ID)
	}
	if listed[2].ID != "oldest" {
		t.Errorf("expected third session to be 'oldest', got %q", listed[2].ID)
	}
}

func TestLoadNonExistentSession_ReturnsError(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	_, err := loadSession("non-existent-session")
	if err == nil {
		t.Fatal("expected error when loading non-existent session, got nil")
	}
}

func TestSessionWithUnicodeContent(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	unicodeContent := "Hello, 世界! 🌍\nПривет, мир!\nمرحبا بالعالم"
	s := &Session{
		ID:       "unicode-session",
		Title:    "Unicode Test",
		Messages: []Message{{Role: "user", Content: unicodeContent}},
		Model:    "llama3",
	}

	if err := saveSession(s); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	loaded, err := loadSession("unicode-session")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}

	if loaded.Messages[0].Content != unicodeContent {
		t.Errorf("unicode content mismatch:\nexpected: %q\n     got: %q", unicodeContent, loaded.Messages[0].Content)
	}
}

func TestListSessions_SkipsNonJSONFiles(t *testing.T) {
	dir, cleanup := tempSessionDir(t)
	defer cleanup()

	// Create a valid session
	s := &Session{ID: "valid", Title: "Valid", Messages: []Message{}, CreatedAt: 1000}
	if err := saveSession(s); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	// Create a non-JSON file in the sessions dir
	if err := os.WriteFile(filepath.Join(dir, "not-a-session.txt"), []byte("garbage"), 0644); err != nil {
		t.Fatalf("failed to write non-JSON file: %v", err)
	}

	// Create a JSON file that is not a valid session
	if err := os.WriteFile(filepath.Join(dir, "invalid.json"), []byte("{not valid json}"), 0644); err != nil {
		t.Fatalf("failed to write invalid JSON: %v", err)
	}

	listed, err := listSessions()
	if err != nil {
		t.Fatalf("listSessions failed: %v", err)
	}

	if len(listed) != 1 {
		t.Fatalf("expected 1 session (skipping non-JSON and invalid), got %d", len(listed))
	}
	if listed[0].ID != "valid" {
		t.Errorf("expected session ID 'valid', got %q", listed[0].ID)
	}
}
