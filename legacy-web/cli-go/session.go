package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Session struct {
	ID           string    `json:"id"`
	Title        string    `json:"title"`
	Messages     []Message `json:"messages"`
	SystemPrompt string    `json:"systemPrompt"`
	Model        string    `json:"model"`
	Temperature  float64   `json:"temperature"`
	TopP         float64   `json:"top_p"`
	NumCtx       int       `json:"num_ctx"`
	CreatedAt    int64     `json:"createdAt"`
}

var getSessionsDir = func() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".bandit_ai", "sessions")
	return dir, nil
}

var ensureSessionsDir = func() (string, error) {
	dir, err := getSessionsDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return dir, nil
}

func saveSession(s *Session) error {
	dir, err := ensureSessionsDir()
	if err != nil {
		return err
	}

	filePath := filepath.Join(dir, s.ID+".json")
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filePath, data, 0600)
}

func loadSession(id string) (*Session, error) {
	dir, err := getSessionsDir()
	if err != nil {
		return nil, err
	}

	filePath := filepath.Join(dir, id+".json")
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var s Session
	if err := json.Unmarshal(data, &s); err != nil {
		return nil, err
	}

	return &s, nil
}

func listSessions() ([]Session, error) {
	dir, err := ensureSessionsDir()
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var sessions []Session
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".json" {
			data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				fmt.Fprintf(os.Stderr, "WARNING: Skipping unreadable session file %s: %v\n", entry.Name(), err)
				continue
			}

			var s Session
			if err := json.Unmarshal(data, &s); err != nil {
				fmt.Fprintf(os.Stderr, "WARNING: Skipping corrupt session file %s: %v\n", entry.Name(), err)
				continue
			}
			sessions = append(sessions, s)
		}
	}

	// Sort by CreatedAt descending
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].CreatedAt > sessions[j].CreatedAt
	})

	return sessions, nil
}
