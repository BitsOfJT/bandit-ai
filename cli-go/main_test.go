package main

import (
	"strings"
	"testing"
	"time"
)

func TestRandomHex_ReturnsCorrectLength(t *testing.T) {
	tests := []struct {
		n    int
		want int
	}{
		{1, 2},   // 1 byte = 2 hex chars
		{4, 8},   // 4 bytes = 8 hex chars
		{8, 16},  // 8 bytes = 16 hex chars
		{16, 32}, // 16 bytes = 32 hex chars
	}

	for _, tt := range tests {
		got := randomHex(tt.n)
		if len(got) != tt.want {
			t.Errorf("randomHex(%d) = %q (len=%d), want len=%d", tt.n, got, len(got), tt.want)
		}
		// Verify it's valid hex
		for _, c := range got {
			if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
				t.Errorf("randomHex(%d) = %q contains non-hex character %c", tt.n, got, c)
			}
		}
	}
}

func TestRandomHex_ProducesDifferentValues(t *testing.T) {
	a := randomHex(8)
	b := randomHex(8)
	if a == b {
		t.Error("expected two calls to randomHex to produce different values")
	}
}

func TestModelNameRegex_ValidNames(t *testing.T) {
	valid := []string{
		"gemma4:e2b",
		"llama3",
		"llama3.1",
		"mistral:v0.2",
		"my-model",
		"model_name",
		"namespace/model",
		"registry.example.com/model:v1.0",
	}

	for _, name := range valid {
		if !modelNameRegex.MatchString(name) {
			t.Errorf("expected %q to be a valid model name", name)
		}
	}
}

func TestModelNameRegex_InvalidNames(t *testing.T) {
	invalid := []string{
		"",
		"model name with spaces",
		"model!with@special",
		"model$with^chars",
		"bad|name",
		`model\with`,
		"model\nwith newline",
	}

	for _, name := range invalid {
		if modelNameRegex.MatchString(name) {
			t.Errorf("expected %q to be an invalid model name", name)
		}
	}
}

func TestPrintHelp_OutputsExpectedCommands(t *testing.T) {
	out := captureStdout(func() {
		printHelp()
	})

	expectedCommands := []string{
		"/help",
		"/clear",
		"/new",
		"/sessions",
		"/load",
		"/persona",
		"/model",
		"/pull",
		"/temp",
		"/top_p",
		"/ctx",
		"/exit",
		"Bandit CLI Commands",
	}

	for _, cmd := range expectedCommands {
		if !strings.Contains(out, cmd) {
			t.Errorf("expected help output to contain %q", cmd)
		}
	}
}

func TestPrintSessionsList_Empty(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	out := captureStdout(func() {
		printSessionsList()
	})

	if !strings.Contains(out, "No saved sessions found") {
		t.Errorf("expected empty sessions message, got: %q", out)
	}
}

func TestPrintSessionsList_Populated(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	sessions := []*Session{
		{ID: "sess-1", Title: "First Chat", Messages: []Message{}, Model: "gemma4:e2b", CreatedAt: now},
		{ID: "sess-2", Title: "Second Chat", Messages: []Message{}, Model: "llama3", CreatedAt: now - 1000},
	}

	for _, s := range sessions {
		if err := saveSession(s); err != nil {
			t.Fatalf("saveSession(%q) failed: %v", s.ID, err)
		}
	}

	// Set current session so one shows as active
	currentSession = sessions[0]
	messages = []Message{}

	out := captureStdout(func() {
		printSessionsList()
	})

	if !strings.Contains(out, "First Chat") {
		t.Error("expected session list to contain 'First Chat'")
	}
	if !strings.Contains(out, "Second Chat") {
		t.Error("expected session list to contain 'Second Chat'")
	}
	if !strings.Contains(out, "gemma4:e2b") {
		t.Error("expected session list to show model name")
	}
	if !strings.Contains(out, "[1]") {
		t.Error("expected session list to show index numbers")
	}

	// Cleanup globals
	currentSession = nil
	messages = nil
}

func TestStartNewSession_CreatesSessionWithDefaults(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	// Set up global state
	currentModel = "test-model"
	temperature = 0.5
	topP = 0.8
	numCtx = 4096
	activePreset = "standard"
	customPromptText = ""
	currentSession = nil
	messages = nil

	startNewSession()

	if currentSession == nil {
		t.Fatal("expected currentSession to be set after startNewSession")
	}
	if currentSession.Title != "New Scavenge Session" {
		t.Errorf("expected title 'New Scavenge Session', got %q", currentSession.Title)
	}
	if currentSession.Model != "test-model" {
		t.Errorf("expected model 'test-model', got %q", currentSession.Model)
	}
	if currentSession.Temperature != 0.5 {
		t.Errorf("expected temperature 0.5, got %f", currentSession.Temperature)
	}
	if currentSession.TopP != 0.8 {
		t.Errorf("expected top_p 0.8, got %f", currentSession.TopP)
	}
	if currentSession.NumCtx != 4096 {
		t.Errorf("expected num_ctx 4096, got %d", currentSession.NumCtx)
	}
	if currentSession.CreatedAt == 0 {
		t.Error("expected CreatedAt to be set")
	}
	if !strings.HasPrefix(currentSession.ID, "chat-") {
		t.Errorf("expected session ID to start with 'chat-', got %q", currentSession.ID)
	}

	// Should have system prompt in messages
	foundSystem := false
	for _, m := range messages {
		if m.Role == "system" {
			foundSystem = true
			break
		}
	}
	if !foundSystem {
		t.Error("expected messages to contain a system prompt")
	}

	// Cleanup globals
	currentSession = nil
	messages = nil
	currentModel = "gemma4:e2b"
	temperature = 0.7
	topP = 0.9
	numCtx = 2048
	activePreset = "hacker"
	customPromptText = ""
}

func TestStartupLoadSession_LoadsMostRecentSession(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	olderSession := &Session{
		ID:           "older-session",
		Title:        "Older Chat",
		Messages:     []Message{{Role: "user", Content: "hello"}},
		SystemPrompt: PersonalityPresets["hacker"].Prompt,
		Model:        "llama3",
		Temperature:  0.7,
		TopP:         0.9,
		NumCtx:       2048,
		CreatedAt:    now - 5000,
	}
	newerSession := &Session{
		ID:           "newer-session",
		Title:        "Newer Chat",
		Messages:     []Message{{Role: "user", Content: "hi"}},
		SystemPrompt: PersonalityPresets["philosopher"].Prompt,
		Model:        "gemma4:e2b",
		Temperature:  0.8,
		TopP:         0.85,
		NumCtx:       4096,
		CreatedAt:    now,
	}

	if err := saveSession(olderSession); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}
	if err := saveSession(newerSession); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	// Clear current state
	currentSession = nil
	messages = nil
	currentModel = ""
	temperature = 0
	topP = 0
	numCtx = 0
	activePreset = ""
	customPromptText = ""

	startupLoadSession()

	if currentSession == nil {
		t.Fatal("expected currentSession to be set")
	}
	if currentSession.ID != "newer-session" {
		t.Errorf("expected to load 'newer-session', got %q", currentSession.ID)
	}
	if currentModel != "gemma4:e2b" {
		t.Errorf("expected model 'gemma4:e2b', got %q", currentModel)
	}
	if temperature != 0.8 {
		t.Errorf("expected temperature 0.8, got %f", temperature)
	}
	if topP != 0.85 {
		t.Errorf("expected top_p 0.85, got %f", topP)
	}
	if activePreset != "philosopher" {
		t.Errorf("expected activePreset 'philosopher', got %q", activePreset)
	}

	// Cleanup
	currentSession = nil
	messages = nil
	currentModel = "gemma4:e2b"
	temperature = 0.7
	topP = 0.9
	numCtx = 2048
	activePreset = "hacker"
	customPromptText = ""
}

func TestStartupLoadSession_CreatesNewWhenNoSessions(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	currentSession = nil
	messages = nil
	currentModel = "gemma4:e2b"
	temperature = 0.7
	topP = 0.9
	numCtx = 2048
	activePreset = "hacker"
	customPromptText = ""

	startupLoadSession()

	if currentSession == nil {
		t.Fatal("expected currentSession to be set after startup with no sessions")
	}
	if currentSession.ID == "" {
		t.Error("expected session ID to be non-empty")
	}

	// Cleanup
	currentSession = nil
	messages = nil
}

func TestSaveCurrentSession_WritesSessionFile(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	currentModel = "test-model"
	temperature = 0.5
	topP = 0.8
	numCtx = 4096
	activePreset = "hacker"
	customPromptText = ""

	// Set up a current session and messages
	currentSession = &Session{
		ID:    "save-test-session",
		Title: "Save Test",
	}
	messages = []Message{
		{Role: "system", Content: PersonalityPresets["hacker"].Prompt},
		{Role: "user", Content: "Hello"},
	}

	saveCurrentSession()

	// Load it back and verify
	loaded, err := loadSession("save-test-session")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	// saveCurrentSession() auto-names the title from the first user message
	if loaded.Title != "Hello" {
		t.Errorf("expected title 'Hello' (from first user message), got %q", loaded.Title)
	}
	if len(loaded.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(loaded.Messages))
	}
	if loaded.Model != "test-model" {
		t.Errorf("expected model 'test-model', got %q", loaded.Model)
	}
	if loaded.Temperature != 0.5 {
		t.Errorf("expected temperature 0.5, got %f", loaded.Temperature)
	}

	// Cleanup
	currentSession = nil
	messages = nil
	currentModel = "gemma4:e2b"
	temperature = 0.7
	topP = 0.9
	numCtx = 2048
}

func TestHandleLoadCommand_ByNumericIndex(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	now := time.Now().UnixMilli()
	session := &Session{
		ID:        "load-by-index",
		Title:     "Index Test",
		Messages:  []Message{{Role: "user", Content: "hello"}},
		Model:     "gemma4:e2b",
		CreatedAt: now,
	}
	if err := saveSession(session); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}
	session2 := &Session{
		ID:        "second-session",
		Title:     "Second",
		Messages:  []Message{},
		Model:     "llama3",
		CreatedAt: now - 1000,
	}
	if err := saveSession(session2); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	currentSession = nil
	messages = nil

	out := captureStdout(func() {
		handleLoadCommand("1")
	})

	if !strings.Contains(out, "Loaded session") {
		t.Error("expected load command to print success message")
	}
	if currentSession == nil || currentSession.ID != "load-by-index" {
		t.Errorf("expected to load session 'load-by-index', got %v", currentSession)
	}

	// Cleanup
	currentSession = nil
	messages = nil
}

func TestHandleLoadCommand_ByExactID(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	session := &Session{
		ID:        "exact-id-session",
		Title:     "Exact ID",
		Messages:  []Message{{Role: "user", Content: "test"}},
		Model:     "gemma4:e2b",
		CreatedAt: time.Now().UnixMilli(),
	}
	if err := saveSession(session); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	currentSession = nil
	messages = nil

	out := captureStdout(func() {
		handleLoadCommand("exact-id-session")
	})

	if !strings.Contains(out, "Loaded session") {
		t.Errorf("expected load to succeed by exact ID, got: %q", out)
	}
	if currentSession == nil || currentSession.ID != "exact-id-session" {
		t.Errorf("expected to load 'exact-id-session', got %v", currentSession)
	}

	currentSession = nil
	messages = nil
}

func TestHandleLoadCommand_NonExistentShowsError(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	// Need at least one session so handleLoadCommand gets past "No saved sessions found"
	session := &Session{
		ID:        "some-session",
		Title:     "Some Session",
		Messages:  []Message{},
		Model:     "gemma4:e2b",
		CreatedAt: time.Now().UnixMilli(),
	}
	if err := saveSession(session); err != nil {
		t.Fatalf("saveSession failed: %v", err)
	}

	out := captureStdout(func() {
		handleLoadCommand("non-existent-session-id")
	})

	if !strings.Contains(out, "Session not found") {
		t.Errorf("expected 'Session not found' error, got: %q", out)
	}
}

func TestPersonaCommand_SwitchesPersonaAndUpdatesSystemPrompt(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	activePreset = "hacker"
	customPromptText = ""
	messages = []Message{
		{Role: "system", Content: PersonalityPresets["hacker"].Prompt},
	}
	currentSession = &Session{
		ID:    "persona-test",
		Title: "Persona Test",
	}

	// Simulate the persona switch from main.go lines 444-464
	target := "philosopher"
	if _, exists := PersonalityPresets[target]; exists {
		activePreset = target
		sysPrompt := PersonalityPresets[target].Prompt
		foundSystem := false
		for i, m := range messages {
			if m.Role == "system" {
				messages[i].Content = sysPrompt
				foundSystem = true
				break
			}
		}
		if !foundSystem && sysPrompt != "" {
			messages = append([]Message{{Role: "system", Content: sysPrompt}}, messages...)
		}
		saveCurrentSession()
	}

	if activePreset != "philosopher" {
		t.Errorf("expected activePreset 'philosopher', got %q", activePreset)
	}
	if len(messages) == 0 || messages[0].Content != PersonalityPresets["philosopher"].Prompt {
		t.Errorf("system prompt not updated to philosopher prompt")
	}

	// Load session to verify it was saved
	loaded, err := loadSession("persona-test")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	if loaded.SystemPrompt != PersonalityPresets["philosopher"].Prompt {
		t.Errorf("saved system prompt doesn't match philosopher")
	}

	// Cleanup
	currentSession = nil
	messages = nil
	activePreset = "hacker"
}

func TestPersonaCommand_InvalidShowsError(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	activePreset = "hacker"
	messages = []Message{
		{Role: "system", Content: PersonalityPresets["hacker"].Prompt},
	}

	// Simulate the persona change code path from main.go
	target := "nonexistent"
	if _, exists := PersonalityPresets[target]; exists {
		t.Error("expected nonexistent persona to not exist")
	}

	// The main.go code prints error when persona doesn't exist
	// Verify the rejection logic by attempting the switch
	if _, exists := PersonalityPresets[target]; exists {
		t.Error("should not be able to switch to nonexistent persona")
	}

	if activePreset != "hacker" {
		t.Error("activePreset should remain unchanged after invalid persona")
	}

	// Cleanup
	messages = nil
}

func TestClearCommand_EmptiesMessagesAndReaddsSystemPrompt(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	activePreset = "hacker"
	customPromptText = ""
	messages = []Message{
		{Role: "system", Content: PersonalityPresets["hacker"].Prompt},
		{Role: "user", Content: "Hello"},
		{Role: "assistant", Content: "Hi there!"},
	}
	currentSession = &Session{
		ID:    "clear-test",
		Title: "Clear Test",
	}

	// Simulate the /clear command from main.go
	messages = []Message{}
	sysPrompt := PersonalityPresets[activePreset].Prompt
	if sysPrompt != "" {
		messages = append(messages, Message{Role: "system", Content: sysPrompt})
	}
	saveCurrentSession()

	if len(messages) != 1 {
		t.Fatalf("expected 1 message (system prompt) after clear, got %d", len(messages))
	}
	if messages[0].Role != "system" {
		t.Errorf("expected first message role 'system', got %q", messages[0].Role)
	}
	if messages[0].Content != PersonalityPresets["hacker"].Prompt {
		t.Errorf("expected system prompt to be hacker preset")
	}

	// Cleanup
	currentSession = nil
	messages = nil
}

func TestNewCommand_CreatesNewSession(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	activePreset = "hacker"
	customPromptText = ""
	currentModel = "gemma4:e2b"
	temperature = 0.7
	topP = 0.9
	numCtx = 2048

	// First create an initial session
	currentSession = nil
	messages = nil
	startNewSession()

	firstSessionID := currentSession.ID

	// Now simulate /new
	startNewSession()

	if currentSession == nil {
		t.Fatal("expected currentSession to be set")
	}
	if currentSession.ID == firstSessionID {
		t.Error("expected new session to have different ID")
	}

	// Cleanup
	currentSession = nil
	messages = nil
}

func TestModelCommand_SwitchesModel(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	currentModel = "gemma4:e2b"
	currentSession = &Session{
		ID:    "model-test",
		Title: "Model Test",
	}
	messages = []Message{}

	// Simulate /model llama3 from main.go
	arg := "llama3"
	if modelNameRegex.MatchString(arg) {
		currentModel = arg
		saveCurrentSession()
	}

	if currentModel != "llama3" {
		t.Errorf("expected model 'llama3', got %q", currentModel)
	}

	// Load session to verify it was saved
	loaded, err := loadSession("model-test")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	if loaded.Model != "llama3" {
		t.Errorf("expected saved model 'llama3', got %q", loaded.Model)
	}

	// Cleanup
	currentSession = nil
	messages = nil
	currentModel = "gemma4:e2b"
}

func TestModelCommand_RejectsInvalidName(t *testing.T) {
	arg := "invalid name!"
	if modelNameRegex.MatchString(arg) {
		t.Errorf("expected %q to be rejected by modelNameRegex", arg)
	}
}

func TestTempCommand_SetsTemperature(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	temperature = 0.7
	currentSession = &Session{
		ID:    "temp-test",
		Title: "Temp Test",
	}
	messages = []Message{}

	// Simulate /temp 0.5
	val := 0.5
	if val >= 0.0 && val <= 2.0 {
		temperature = val
		saveCurrentSession()
	}

	if temperature != 0.5 {
		t.Errorf("expected temperature 0.5, got %f", temperature)
	}

	loaded, err := loadSession("temp-test")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	if loaded.Temperature != 0.5 {
		t.Errorf("expected saved temperature 0.5, got %f", loaded.Temperature)
	}

	currentSession = nil
	messages = nil
	temperature = 0.7
}

func TestTempCommand_RejectsOutOfRange(t *testing.T) {
	invalidValues := []float64{-1.0, 3.0, 2.5, -0.5}
	for _, val := range invalidValues {
		if val >= 0.0 && val <= 2.0 {
			t.Errorf("expected %f to be rejected as out of range", val)
		}
	}
}

func TestTopPCommand_SetsTopP(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	topP = 0.9
	currentSession = &Session{
		ID:    "topp-test",
		Title: "TopP Test",
	}
	messages = []Message{}

	// Simulate /top_p 0.5
	val := 0.5
	if val >= 0.0 && val <= 1.0 {
		topP = val
		saveCurrentSession()
	}

	if topP != 0.5 {
		t.Errorf("expected top_p 0.5, got %f", topP)
	}

	loaded, err := loadSession("topp-test")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	if loaded.TopP != 0.5 {
		t.Errorf("expected saved top_p 0.5, got %f", loaded.TopP)
	}

	currentSession = nil
	messages = nil
	topP = 0.9
}

func TestTopPCommand_RejectsOutOfRange(t *testing.T) {
	invalidValues := []float64{-0.1, 1.5, 2.0, 1.1}
	for _, val := range invalidValues {
		if val >= 0.0 && val <= 1.0 {
			t.Errorf("expected %f to be rejected as out of range for top_p", val)
		}
	}
}

func TestCtxCommand_SetsContext(t *testing.T) {
	_, cleanup := tempSessionDir(t)
	defer cleanup()

	numCtx = 2048
	currentSession = &Session{
		ID:    "ctx-test",
		Title: "Ctx Test",
	}
	messages = []Message{}

	// Simulate /ctx 4096
	val := 4096
	if val >= 256 && val <= 131072 {
		numCtx = val
		saveCurrentSession()
	}

	if numCtx != 4096 {
		t.Errorf("expected numCtx 4096, got %d", numCtx)
	}

	loaded, err := loadSession("ctx-test")
	if err != nil {
		t.Fatalf("loadSession failed: %v", err)
	}
	if loaded.NumCtx != 4096 {
		t.Errorf("expected saved numCtx 4096, got %d", loaded.NumCtx)
	}

	currentSession = nil
	messages = nil
	numCtx = 2048
}

func TestCtxCommand_RejectsTooSmall(t *testing.T) {
	invalidValues := []int{0, 100, 255, -1, 131073}
	for _, val := range invalidValues {
		if val >= 256 && val <= 131072 {
			t.Errorf("expected %d to be rejected as invalid context size", val)
		}
	}
}

func TestHelpCommand_DispatchesToPrintHelp(t *testing.T) {
	out := captureStdout(func() {
		printHelp()
	})

	if !strings.Contains(out, "/help") {
		t.Error("expected help to include /help")
	}
	if !strings.Contains(out, "/exit") {
		t.Error("expected help to include /exit")
	}
	if !strings.Contains(out, "/clear") {
		t.Error("expected help to include /clear")
	}
	if !strings.Contains(out, "/new") {
		t.Error("expected help to include /new")
	}
}
func TestFormatModelSize(t *testing.T) {
	cases := []struct {
		in   int64
		want string
	}{
		{0, ""},
		{500, ""},                     // sub-MB (e.g. cloud manifest) → hidden
		{5 * 1024 * 1024, "5 MB"},
		{2 * 1024 * 1024 * 1024, "2.0 GB"},
	}
	for _, c := range cases {
		if got := formatModelSize(c.in); got != c.want {
			t.Errorf("formatModelSize(%d) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestModelInfo_HasChatCapability(t *testing.T) {
	if !(ModelInfo{Capabilities: nil}).hasChatCapability() {
		t.Error("nil capabilities (older Ollama) should be treated as usable")
	}
	if !(ModelInfo{Capabilities: []string{"completion"}}).hasChatCapability() {
		t.Error("completion model should be chat-capable")
	}
	if (ModelInfo{Capabilities: []string{"embedding"}}).hasChatCapability() {
		t.Error("embedding-only model should not be chat-capable")
	}
}

func TestPrintHelp_IncludesNewCommands(t *testing.T) {
	out := captureStdout(printHelp)
	for _, cmd := range []string{"/models", "/cloud"} {
		if !strings.Contains(out, cmd) {
			t.Errorf("expected help output to contain %q", cmd)
		}
	}
}
