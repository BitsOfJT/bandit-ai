package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var OllamaHost = "http://127.0.0.1:11434"

type TagsResponse struct {
	Models []ModelInfo `json:"models"`
}

type ModelInfo struct {
	Name string `json:"name"`
}

type ChatRequest struct {
	Model    string      `json:"model"`
	Messages []Message   `json:"messages"`
	Options  ChatOptions `json:"options"`
	Stream   bool        `json:"stream"`
}

type ChatOptions struct {
	Temperature float64 `json:"temperature"`
	TopP        float64 `json:"top_p"`
	NumCtx      int     `json:"num_ctx"`
}

type ChatResponse struct {
	Message Message `json:"message"`
	Done    bool    `json:"done"`
}

type PullRequest struct {
	Name   string `json:"name"`
	Stream bool   `json:"stream"`
}

type PullResponse struct {
	Status    string `json:"status"`
	Completed int64  `json:"completed"`
	Total     int64  `json:"total"`
}

func verifyOllama() ([]string, error) {
	client := &http.Client{
		Timeout: 2 * time.Second,
	}
	resp, err := client.Get(OllamaHost + "/api/tags")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http error: %d", resp.StatusCode)
	}

	var tags TagsResponse
	if err := json.NewDecoder(resp.Body).Decode(&tags); err != nil {
		return nil, err
	}

	var modelNames []string
	for _, m := range tags.Models {
		modelNames = append(modelNames, m.Name)
	}
	return modelNames, nil
}

func pullModel(ctx context.Context, modelName string) error {
	fmt.Printf("\n\x1b[32mBandit:\x1b[0m Connecting to Ollama to pull \x1b[33m%s\x1b[0m...\n", modelName)
	
	reqBody, err := json.Marshal(PullRequest{Name: modelName, Stream: true})
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", OllamaHost+"/api/pull", bytes.NewBuffer(reqBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("http error: %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadBytes('\n')
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}

		var p PullResponse
		if err := json.Unmarshal(line, &p); err != nil {
			continue
		}

		if p.Total > 0 {
			percent := float64(p.Completed) / float64(p.Total) * 100
			barLength := 30
			filledLength := int(float64(p.Completed) / float64(p.Total) * float64(barLength))
			
			bar := ""
			for i := 0; i < filledLength; i++ {
				bar += "="
			}
			for i := filledLength; i < barLength; i++ {
				bar += " "
			}

			compGB := float64(p.Completed) / 1024.0 / 1024.0 / 1024.0
			totalGB := float64(p.Total) / 1024.0 / 1024.0 / 1024.0

			fmt.Printf("\r\x1b[36mDownloading [%s] %.0f%% (%.2fGB / %.2fGB)\x1b[0m", bar, percent, compGB, totalGB)
		} else {
			fmt.Printf("\r\x1b[90mStatus: %-60s\x1b[0m", p.Status)
		}
	}
	fmt.Printf("\n\n\x1b[32mBandit:\x1b[0m Model \x1b[33m%s\x1b[0m successfully installed! 🦝💾\n\n", modelName)
	return nil
}

func chatStream(ctx context.Context, s *Session, formatter *MarkdownFormatter) (string, error) {
	reqBody, err := json.Marshal(ChatRequest{
		Model:    s.Model,
		Messages: s.Messages,
		Options: ChatOptions{
			Temperature: s.Temperature,
			TopP:        s.TopP,
			NumCtx:      s.NumCtx,
		},
		Stream: true,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", OllamaHost+"/api/chat", bytes.NewBuffer(reqBody))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("http error: %d", resp.StatusCode)
	}

	fmt.Printf("\n\x1b[32m\x1b[1mBandit:\x1b[0m \x1b[36m")

	reader := bufio.NewReader(resp.Body)
	var accumulated string

	for {
		line, err := reader.ReadBytes('\n')
		if err == io.EOF {
			break
		}
		if err != nil {
			return accumulated, err
		}

		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}

		var c ChatResponse
		if err := json.Unmarshal(line, &c); err != nil {
			continue
		}

		token := c.Message.Content
		if token != "" {
			accumulated += token
			formatter.FormatAndPrint(token)
		}

		if c.Done {
			break
		}
	}

	formatter.Flush()
	fmt.Printf("\x1b[0m\n\n")

	return accumulated, nil
}
