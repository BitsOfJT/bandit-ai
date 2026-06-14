package main

import (
	"fmt"
	"regexp"
	"strings"
)

const (
	CReset     = "\x1b[0m"
	CBright    = "\x1b[1m"
	CGreen     = "\x1b[32m"
	CMagenta   = "\x1b[35m"
	CCyan      = "\x1b[36m"
	CYellow    = "\x1b[33m"
	CRed       = "\x1b[31m"
	CGray      = "\x1b[90m"
	CNeonGreen = "\x1b[38;5;82m"
	CHotPink   = "\x1b[38;5;201m"
)

type MarkdownFormatter struct {
	InCodeBlock   bool
	InInlineCode  bool
	InBold        bool
	BacktickCount int
	StarCount     int
	CurrentStyle  string
}

func NewMarkdownFormatter() *MarkdownFormatter {
	return &MarkdownFormatter{
		CurrentStyle: CCyan,
	}
}

func (m *MarkdownFormatter) FormatAndPrint(token string) {
	output := ""
	for _, char := range token {
		if char == '`' {
			m.BacktickCount++
			continue
		} else {
			if m.BacktickCount == 1 {
				m.InInlineCode = !m.InInlineCode
				if m.InInlineCode {
					m.CurrentStyle = CYellow
				} else {
					m.CurrentStyle = CCyan
				}
				output += CReset + m.CurrentStyle
				m.BacktickCount = 0
			} else if m.BacktickCount == 3 {
				m.InCodeBlock = !m.InCodeBlock
				if m.InCodeBlock {
					output += "\n" + CGray + "┌── CODE ──────────────────────────" + CReset + "\n" + CGreen
					m.CurrentStyle = CGreen
				} else {
					output += "\n" + CReset + CGray + "└──────────────────────────────────" + CReset + "\n" + CCyan
					m.CurrentStyle = CCyan
				}
				m.BacktickCount = 0
			} else if m.BacktickCount > 0 {
				for i := 0; i < m.BacktickCount; i++ {
					output += "`"
				}
				m.BacktickCount = 0
			}
		}

		if char == '*' {
			if m.InInlineCode || m.InCodeBlock {
				output += "*"
				continue
			}
			m.StarCount++
			continue
		} else {
			if m.StarCount == 2 {
				m.InBold = !m.InBold
				if m.InBold {
					output += CBright
				} else {
					output += CReset + m.CurrentStyle
				}
				m.StarCount = 0
			} else if m.StarCount == 1 {
				output += "*"
				m.StarCount = 0
			} else if m.StarCount > 2 {
				for i := 0; i < m.StarCount; i++ {
					output += "*"
				}
				m.StarCount = 0
			}
		}

		output += string(char)
	}
	fmt.Print(output)
}

func (m *MarkdownFormatter) Flush() {
	output := ""
	if m.BacktickCount > 0 {
		if m.BacktickCount == 1 {
			m.InInlineCode = !m.InInlineCode
			if m.InInlineCode {
				output += CReset + CYellow
			} else {
				output += CReset + CCyan
			}
		} else if m.BacktickCount == 3 {
			m.InCodeBlock = !m.InCodeBlock
			if m.InCodeBlock {
				output += "\n" + CGray + "┌── CODE ──────────────────────────" + CReset + "\n" + CGreen
			} else {
				output += "\n" + CReset + CGray + "└──────────────────────────────────" + CReset + "\n" + CCyan
			}
		} else {
			for i := 0; i < m.BacktickCount; i++ {
				output += "`"
			}
		}
		m.BacktickCount = 0
	}

	if m.StarCount > 0 {
		if m.StarCount == 2 {
			m.InBold = !m.InBold
			if m.InBold {
				output += CBright
			} else {
				output += CReset + m.CurrentStyle
			}
		} else if m.StarCount == 1 {
			output += "*"
		} else {
			for i := 0; i < m.StarCount; i++ {
				output += "*"
			}
		}
		m.StarCount = 0
	}
	fmt.Print(output)
}

func ColorizeMarkdown(text string) string {
	parts := strings.Split(text, "```")
	var result []string

	for idx, part := range parts {
		if idx%2 == 1 {
			lines := strings.Split(part, "\n")
			lang := "code"
			codeLines := lines

			if len(lines) > 0 {
				firstLine := strings.TrimSpace(lines[0])
				if len(firstLine) > 0 && !strings.Contains(firstLine, " ") && !strings.Contains(firstLine, "\t") {
					lang = firstLine
					codeLines = lines[1:]
				}
			}

			if len(codeLines) > 0 && codeLines[len(codeLines)-1] == "" {
				codeLines = codeLines[:len(codeLines)-1]
			}

			var formatted []string
			header := fmt.Sprintf("  %s┌── %s %s", CGray, CReset+CBright+CCyan+strings.ToUpper(lang)+CReset+CGray, strings.Repeat("─", 40))
			formatted = append(formatted, header)
			for _, line := range codeLines {
				formatted = append(formatted, fmt.Sprintf("  %s│%s  %s%s%s", CGray, CReset, CGreen, line, CReset))
			}
			footer := fmt.Sprintf("  %s└%s", CGray, strings.Repeat("─", 50)+CReset)
			formatted = append(formatted, footer)

			result = append(result, "\n"+strings.Join(formatted, "\n")+"\n")
		} else {
			formatted := part
			
			reBold := regexp.MustCompile(`\*\*(.*?)\*\*`)
			formatted = reBold.ReplaceAllString(formatted, CBright+"$1"+CReset+CCyan)

			reCode := regexp.MustCompile("`(.*?)`")
			formatted = reCode.ReplaceAllString(formatted, CYellow+"$1"+CReset+CCyan)

			lines := strings.Split(formatted, "\n")
			reList := regexp.MustCompile(`^(\s*)([-*+])\s+(.*)$`)
			for i, line := range lines {
				if matches := reList.FindStringSubmatch(line); matches != nil {
					indent := matches[1]
					content := matches[3]
					lines[i] = fmt.Sprintf("%s  %s•%s %s%s", indent, CYellow, CReset, CCyan, content)
				}
			}
			result = append(result, strings.Join(lines, "\n"))
		}
	}

	return strings.Join(result, "")
}
