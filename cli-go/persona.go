package main

import (
	_ "embed"
	"strings"
)

// banditSoul is the full Bandit persona, embedded verbatim from bandit-soul.md.
// The canonical source is the repo-root bandit-soul.md; this package keeps a
// mirror because //go:embed cannot reach outside its own directory. Keep the two
// in sync with `go generate ./...` (also run by the build:cli npm scripts). The
// persona_test.go drift guard fails the build if the mirror falls behind.
//
//go:generate cp ../bandit-soul.md ./bandit-soul.md
//go:embed bandit-soul.md
var banditSoul string

// init injects the full soul doc as the default "hacker" persona prompt. preset.go
// declares the entry with an empty Prompt; the real content lives in bandit-soul.md.
func init() {
	p := PersonalityPresets["hacker"]
	p.Prompt = strings.TrimSpace(banditSoul)
	PersonalityPresets["hacker"] = p
}
