package main

import (
	"os"
	"strings"
	"testing"
)

// TestBanditSoulMirrorInSync guards the single-source invariant: cli-go/bandit-soul.md
// is a build mirror of the repo-root bandit-soul.md. If the root file is edited without
// re-running `go generate ./...`, this fails so the drift is caught before release.
func TestBanditSoulMirrorInSync(t *testing.T) {
	root, err := os.ReadFile("../bandit-soul.md")
	if err != nil {
		t.Fatalf("reading root bandit-soul.md: %v", err)
	}
	if strings.TrimSpace(string(root)) != strings.TrimSpace(banditSoul) {
		t.Fatal("cli-go/bandit-soul.md is out of sync with ../bandit-soul.md — run `go generate ./...`")
	}
}

// TestHackerPersonaIsSoul verifies the default persona actually carries the soul doc.
func TestHackerPersonaIsSoul(t *testing.T) {
	got := PersonalityPresets["hacker"].Prompt
	if got == "" {
		t.Fatal("hacker persona prompt is empty — embed/init did not run")
	}
	if got != strings.TrimSpace(banditSoul) {
		t.Error("hacker persona prompt does not match embedded bandit-soul.md")
	}
}
