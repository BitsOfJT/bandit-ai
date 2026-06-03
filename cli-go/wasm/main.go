package main

import (
	"encoding/json"
	"strings"
	"syscall/js"
)

type Block struct {
	Type string `json:"type"`
	Raw  string `json:"raw"`
	Lang string `json:"lang,omitempty"`
}

func parseMarkdownBlocks(this js.Value, args []js.Value) any {
	if len(args) < 1 {
		return "[]"
	}
	content := args[0].String()
	if content == "" {
		return "[]"
	}

	var blocks []Block
	lines := strings.Split(content, "\n")
	var currentBlock []string
	inCodeBlock := false
	codeLanguage := ""
	inTable := false

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		// Handle code block toggle
		if strings.HasPrefix(trimmed, "```") {
			if inCodeBlock {
				blocks = append(blocks, Block{
					Type: "code",
					Raw:  strings.Join(currentBlock, "\n"),
					Lang: codeLanguage,
				})
				currentBlock = nil
				inCodeBlock = false
			} else {
				// Flush existing text or table block
				if len(currentBlock) > 0 {
					blockType := "text"
					if inTable {
						blockType = "table"
					}
					blocks = append(blocks, Block{
						Type: blockType,
						Raw:  strings.Join(currentBlock, "\n"),
					})
					currentBlock = nil
				}
				inCodeBlock = true
				inTable = false
				codeLanguage = strings.TrimSpace(trimmed[3:])
			}
			continue
		}

		if inCodeBlock {
			currentBlock = append(currentBlock, line)
			continue
		}

		// Handle Table
		isTableLine := strings.HasPrefix(trimmed, "|") && strings.HasSuffix(trimmed, "|")
		if isTableLine {
			if !inTable {
				// Flush text block
				if len(currentBlock) > 0 {
					blocks = append(blocks, Block{
						Type: "text",
						Raw:  strings.Join(currentBlock, "\n"),
					})
					currentBlock = nil
				}
				inTable = true
			}
			currentBlock = append(currentBlock, line)
			continue
		} else {
			if inTable {
				// Flush table block
				blocks = append(blocks, Block{
					Type: "table",
					Raw:  strings.Join(currentBlock, "\n"),
				})
				currentBlock = nil
				inTable = false
			}
		}

		currentBlock = append(currentBlock, line)
	}

	// Flush any remaining blocks
	if len(currentBlock) > 0 {
		blockType := "text"
		if inCodeBlock {
			blockType = "code"
		} else if inTable {
			blockType = "table"
		}
		blocks = append(blocks, Block{
			Type: blockType,
			Raw:  strings.Join(currentBlock, "\n"),
			Lang: codeLanguage,
		})
	}

	jsonData, err := json.Marshal(blocks)
	if err != nil {
		return "[]"
	}

	return string(jsonData)
}

func main() {
	// Expose our fast block parser to JavaScript globally
	js.Global().Set("parseMarkdownBlocks", js.FuncOf(parseMarkdownBlocks))
	
	// Keep WASM thread running
	select {}
}
