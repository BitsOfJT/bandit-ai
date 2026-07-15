package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"testing"
)

// captureStdout runs fn and returns everything written to stdout.
func captureStdout(fn func()) string {
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	fn()

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	io.Copy(&buf, r)
	return buf.String()
}

func TestNewMarkdownFormatter(t *testing.T) {
	m := NewMarkdownFormatter()
	if m == nil {
		t.Fatal("NewMarkdownFormatter returned nil")
	}
	if m.InCodeBlock {
		t.Error("expected InCodeBlock to be false")
	}
	if m.InInlineCode {
		t.Error("expected InInlineCode to be false")
	}
	if m.InBold {
		t.Error("expected InBold to be false")
	}
	if m.BacktickCount != 0 {
		t.Errorf("expected BacktickCount 0, got %d", m.BacktickCount)
	}
	if m.StarCount != 0 {
		t.Errorf("expected StarCount 0, got %d", m.StarCount)
	}
	if m.CurrentStyle != CCyan {
		t.Errorf("expected CurrentStyle %q, got %q", CCyan, m.CurrentStyle)
	}
}

func TestFormatAndPrint_PlainText(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("hello world")
	})
	// Plain text passes through without style prefix (style is only applied on toggle)
	if out != "hello world" {
		t.Errorf("expected %q, got %q", "hello world", out)
	}
}

func TestFormatAndPrint_InlineCode(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("text `code` more")
	})
	// After the backtick, style switches to CYellow, then back to CCyan
	if !strings.Contains(out, CYellow) {
		t.Error("expected inline code to use CYellow")
	}
	if !strings.Contains(out, "code") {
		t.Error("expected 'code' to appear in output")
	}
	// The backticks themselves should not appear
	if strings.Contains(out, "``") {
		t.Error("backticks should not appear in output")
	}
}

func TestFormatAndPrint_CodeBlock(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("before ```code block``` after")
	})
	// Code block should have the CODE header
	if !strings.Contains(out, "CODE") {
		t.Error("expected code block to contain CODE header")
	}
	if !strings.Contains(out, "code block") {
		t.Error("expected 'code block' to appear in output")
	}
}

func TestFormatAndPrint_Bold(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("text **bold** more")
	})
	// Bold should use CBright
	if !strings.Contains(out, CBright) {
		t.Error("expected bold to use CBright")
	}
	if !strings.Contains(out, "bold") {
		t.Error("expected 'bold' to appear in output")
	}
	// The ** markers should not appear
	if strings.Contains(out, "****") {
		t.Error("double stars should not appear in output")
	}
}

func TestFormatAndPrint_SingleStar(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("single * star")
	})
	// Single star should output literally
	if !strings.Contains(out, "*") {
		t.Error("expected single star to appear literally")
	}
}

func TestFormatAndPrint_TriplePlusStars(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("*** triple *** stars")
	})
	// Triple+ stars should output literally (the *** fix)
	if !strings.Contains(out, "***") {
		t.Error("expected triple stars to appear literally")
	}
}

func TestFormatAndPrint_StarsInsideInlineCode(t *testing.T) {
	m := NewMarkdownFormatter()
	out := captureStdout(func() {
		m.FormatAndPrint("`**not bold**`")
	})
	// Stars inside inline code should output literally
	if !strings.Contains(out, "**") {
		t.Error("expected stars inside inline code to appear literally")
	}
	// Should NOT have CBright (bold) applied
	if strings.Contains(out, CBright) {
		t.Error("expected no bold formatting inside inline code")
	}
}

func TestFlush_UnclosedBacktick(t *testing.T) {
	m := NewMarkdownFormatter()
	// Pass a token that ends with a single backtick (unclosed)
	m.FormatAndPrint("`")
	// BacktickCount should be 1 now
	if m.BacktickCount != 1 {
		t.Fatalf("expected BacktickCount 1, got %d", m.BacktickCount)
	}
	// Flush toggles the inline code state (opens it since it was closed)
	out := captureStdout(func() {
		m.Flush()
	})
	if !strings.Contains(out, CReset) {
		t.Error("expected Flush to emit reset for unclosed backtick")
	}
	// Flush toggles InInlineCode: false → true
	if !m.InInlineCode {
		t.Error("expected InInlineCode to be true after Flush (toggled from false)")
	}
	if m.BacktickCount != 0 {
		t.Errorf("expected BacktickCount 0 after Flush, got %d", m.BacktickCount)
	}
}

func TestFlush_UnclosedBold(t *testing.T) {
	m := NewMarkdownFormatter()
	// Pass a token that ends with double star (unclosed bold)
	m.FormatAndPrint("**")
	// StarCount should be 2 now
	if m.StarCount != 2 {
		t.Fatalf("expected StarCount 2, got %d", m.StarCount)
	}
	out := captureStdout(func() {
		m.Flush()
	})
	if !strings.Contains(out, CBright) {
		t.Error("expected Flush to emit CBright for unclosed bold")
	}
	// Flush toggles InBold: false → true
	if !m.InBold {
		t.Error("expected InBold to be true after Flush (toggled from false)")
	}
	if m.StarCount != 0 {
		t.Errorf("expected StarCount 0 after Flush, got %d", m.StarCount)
	}
}

func TestColorizeMarkdown_CodeBlocks(t *testing.T) {
	input := "before ```go\npackage main\n``` after"
	out := ColorizeMarkdown(input)
	if !strings.Contains(out, "GO") {
		t.Error("expected code block to contain language label GO")
	}
	if !strings.Contains(out, "package main") {
		t.Error("expected code content to appear")
	}
}

func TestColorizeMarkdown_Bold(t *testing.T) {
	input := "this is **bold** text"
	out := ColorizeMarkdown(input)
	if !strings.Contains(out, CBright) {
		t.Error("expected bold text to use CBright")
	}
	if !strings.Contains(out, "bold") {
		t.Error("expected 'bold' to appear")
	}
}

func TestColorizeMarkdown_InlineCode(t *testing.T) {
	input := "use `code` here"
	out := ColorizeMarkdown(input)
	if !strings.Contains(out, CYellow) {
		t.Error("expected inline code to use CYellow")
	}
	if !strings.Contains(out, "code") {
		t.Error("expected 'code' to appear")
	}
}

func TestColorizeMarkdown_BulletLists(t *testing.T) {
	input := "- item one\n- item two"
	out := ColorizeMarkdown(input)
	// Bullet lists should use the bullet character
	if !strings.Contains(out, "•") {
		t.Error("expected bullet character in list output")
	}
}
