package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	currentModel     = "gemma4:e2b"
	temperature      = 0.7
	topP             = 0.9
	numCtx           = 2048
	activePreset     = "hacker"
	customPromptText = ""
	currentSession   *Session
	messages         []Message
)

var modelNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_:./-]+$`)

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%x", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func clearScreen() {
	fmt.Print("\x1b[H\x1b[2J")
}

func getAsciiArt(modelName string) string {
	logo := CNeonGreen + CBright +
		"______                 _ _ _      ___  _____\n" +
		"| ___ \\               | (_) |    / _ \\|_   _|\n" +
		"| |_/ / __ _ _ __   __| |_| |_  / /_\\ \\ | |  \n" +
		"| ___ \\/ _` | '_ \\ / _` | | __| |  _  | | |  \n" +
		"| |_/ / (_| | | | | (_| | | |_  | | | |_| |_\n" +
		"\\____/ \\__,_|_| |_|\\__,_|_|\\__| \\_| |_/\\___/ " + CReset + "\n\n" +
		CGray + ".                                                    ." + CReset + "\n" +
		"                                                       \n" +
		CGray + ".                                                    ." + CReset + "\n" +
		CGray + ".                                                    ." + CReset + "\n" +
		"          " + CGreen + ".---:." + CReset + "                        " + CGreen + ".:--:" + CReset + "         " + CGray + "." + CReset + "\n" +
		"        " + CGreen + ".:#*++**=: ." + CReset + "                " + CGreen + "..-+*+++#*.." + CReset + "      " + CGray + ":" + CReset + "\n" +
		"        " + CGreen + ".+*   .:=*=...:::------:::..." + CReset + CHotPink + "++-:.  .#:." + CReset + "      " + CGray + "." + CReset + "\n" +
		"       " + CGreen + "..=*   " + CReset + CHotPink + ":-:." + CReset + CGreen + "== --::--==--::=:." + CReset + CHotPink + "+-.:-:  .#:." + CReset + "      " + CGray + "." + CReset + "\n" +
		"        " + CGreen + ".:#=   " + CReset + CHotPink + ".-:" + CReset + CGreen + ".:................:.:-.  .++.." + CReset + "      " + CGray + "." + CReset + "\n" +
		"        " + CGreen + "..:#=. .....:--::=- .=-::--:...:. .+*.." + CReset + "\n" +
		"         " + CGray + ":" + CReset + CHotPink + ".-*-:...:-=-:" + CReset + CGreen + "*+-- .--*+" + CReset + CHotPink + "==-:...:=*..." + CReset + "       " + CGray + ":" + CReset + "\n" +
		"       " + CGray + "..:::" + CReset + CHotPink + "=:.:" + CReset + CGreen + "=**#%#=:%#.  -%*:+#%#*+=:" + CReset + CHotPink + ".-=.:." + CReset + "       " + CGray + "." + CReset + "\n" +
		"       " + CGreen + ".::.-.---=++=:-=.-*-..=+.:=:-=+==--.:: :" + CReset + "       " + CGray + "." + CReset + "\n" +
		"        " + CGreen + "..+.:=..**:." + CReset + "      " + CGreen + "::.. **-." + CReset + "      " + CHotPink + ".-.-=.." + CReset + "      " + CGray + ":" + CReset + "\n" +
		"       " + CHotPink + ".:*=+%+::*: ::.         +. ...    :*%+*+.." + CReset + "     " + CGray + "." + CReset + "\n" +
		"      " + CGreen + "..==--. =." + CReset + "   " + CGray + ".:. .  .::.    ..  ::.." + CReset + " " + CHotPink + ":==*-.." + CReset + "    " + CGray + "." + CReset + "\n" +
		"      " + CGreen + ".--.." + CReset + "    " + CGray + ":........" + CReset + CHotPink + "-#=::**:" + CReset + "     " + CGray + "::.." + CReset + "    " + CHotPink + ".:=:" + CReset + "     " + CGray + ":" + CReset + "\n" +
		"      " + CGray + "...-:.    :::..." + CReset + CGreen + "=#@%=" + CReset + CHotPink + ":-" + CReset + CGreen + "+@@#-" + CReset + "  " + CGray + "....    .::.." + CReset + "     " + CGray + ":" + CReset + "\n" +
		"       " + CGray + "..--:.    .:::+#@#." + CReset + CHotPink + "-++::" + CReset + CGreen + "@%#=::.." + CReset + "   " + CGray + ".::-:." + CReset + "\n" +
		"         " + CGray + "..:::-::::" + CReset + CGreen + "-=+*#*..  .:#*+=-" + CReset + CGray + ":::::::-.." + CReset + "        " + CGray + "." + CReset + "\n" +
		"           " + CGray + ".:::::.:::..--::" + CReset + " " + CHotPink + ".:--:..:::.::::.." + CReset + "         " + CGray + "." + CReset + "\n" +
		"           " + CGray + ".   .:.....  .::::::.  ..:..:.  .." + CReset + "         " + CGray + ":" + CReset + "\n" +
		"               " + CGray + ".     ...       ......   ." + CReset + "             " + CGray + ":" + CReset + "\n" +
		"                                   " + CGray + ".." + CReset + "                 " + CGray + "." + CReset + "\n" +
		"                                                       " + CGray + "." + CReset + "\n" +
		"                                                       \n" +
		"                                                       " + CGray + "." + CReset + "\n" +
		" " + CGray + ".                                                    :" + CReset + "\n\n" +
		"  " + CReset + CBright + "Active Model:" + CReset + " " + CYellow + CBright + modelName + CReset + " | " + CBright + "Status:" + CReset + " " + CGreen + "READY FOR SCAVENGING" + CReset + "\n" +
		"  " + CBright + "Commands:" + CReset + " " + CMagenta + "/exit" + CReset + ", " + CMagenta + "/clear" + CReset + ", " + CMagenta + "/new" + CReset + ", " + CMagenta + "/sessions" + CReset + ", " + CMagenta + "/load" + CReset + ", " + CMagenta + "/persona" + CReset + ", " + CMagenta + "/models" + CReset + ", " + CMagenta + "/model" + CReset + ", " + CMagenta + "/cloud" + CReset + ", " + CMagenta + "/pull" + CReset + ", " + CMagenta + "/help" + CReset + "\n"
	return logo
}

// formatModelSize renders a byte count as a human-friendly GB/MB string.
func formatModelSize(bytes int64) string {
	if bytes <= 0 {
		return ""
	}
	const gb = 1024.0 * 1024.0 * 1024.0
	const mb = 1024.0 * 1024.0
	if float64(bytes) >= gb {
		return fmt.Sprintf("%.1f GB", float64(bytes)/gb)
	}
	if float64(bytes) < mb {
		return "" // tiny manifest (e.g. a cloud model) — size isn't meaningful
	}
	return fmt.Sprintf("%.0f MB", float64(bytes)/mb)
}

// sortedModels returns the local models sorted by name for a stable, numbered list.
func sortedModels() ([]ModelInfo, error) {
	models, err := fetchModels()
	if err != nil {
		return nil, err
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Name < models[j].Name })
	return models, nil
}

// printModelsList shows the locally installed models, numbered, with the active
// one marked. Numbers can be passed to /model to switch (e.g. /model 2).
func printModelsList() {
	models, err := sortedModels()
	if err != nil {
		fmt.Printf("\n%sWARNING:%s Couldn't reach Ollama on %s to list models. Is it running?%s\n\n", CRed+CBright, CReset, OllamaHost, CReset)
		return
	}
	if len(models) == 0 {
		fmt.Printf("\n%sNo models installed.%s Download one with %s/pull gemma4:e2b%s, or browse cloud models with %s/cloud%s.\n\n",
			CYellow, CReset, CMagenta, CReset, CMagenta, CReset)
		return
	}

	fmt.Printf("\n%s%sInstalled Models:%s\n", CCyan, CBright, CReset)
	for idx, m := range models {
		marker := " "
		if m.Name == currentModel {
			marker = "\x1b[32m*\x1b[0m"
		}
		meta := ""
		if size := formatModelSize(m.Size); size != "" {
			meta = size
		}
		if m.Details.ParameterSize != "" {
			if meta != "" {
				meta += ", "
			}
			meta += m.Details.ParameterSize
		}
		if meta != "" {
			meta = fmt.Sprintf(" %s(%s)%s", CGray, meta, CReset)
		}
		warn := ""
		if !m.hasChatCapability() {
			warn = fmt.Sprintf(" %s[not a chat model]%s", CRed, CReset)
		}
		fmt.Printf("  [%d] %s %s%-28s%s%s%s\n", idx+1, marker, CYellow, m.Name, CReset, meta, warn)
	}
	fmt.Printf("\nSwitch with %s/model <number>%s or %s/model <name>%s. Browse cloud models with %s/cloud%s.\n\n",
		CMagenta, CReset, CMagenta, CReset, CMagenta, CReset)
}

// resolveModelArg turns a /model argument into a model name. A bare integer is
// treated as a 1-based index into the installed-model list; anything else is
// returned as-is (a literal model name, possibly a cloud model not yet installed).
func resolveModelArg(arg string) string {
	var idx int
	if _, err := fmt.Sscanf(arg, "%d", &idx); err == nil && fmt.Sprintf("%d", idx) == arg {
		models, err := sortedModels()
		if err == nil && idx >= 1 && idx <= len(models) {
			return models[idx-1].Name
		}
	}
	return arg
}

// printChatError shows the real reason a chat request failed and, where
// possible, an actionable next step. The most common case is switching to a
// model that isn't installed — which should point the user at /pull, not at
// "is Ollama running?".
func printChatError(err error) {
	msg := err.Error()
	low := strings.ToLower(msg)

	fmt.Printf("\n\n%s%sError:%s %s\n", CRed, CBright, CReset, msg)

	switch {
	case strings.Contains(low, "not found") || strings.Contains(low, "try pulling"):
		fmt.Printf("%sHint:%s Run %s/models%s to see installed models, or %s/pull %s%s to download this one.\n\n",
			CYellow, CReset, CMagenta, CReset, CMagenta, currentModel, CReset)
	case strings.Contains(low, "unauthorized") || strings.Contains(low, "sign in") ||
		strings.Contains(low, "signin") || strings.Contains(low, "401") || strings.Contains(low, "403"):
		fmt.Printf("%sHint:%s Cloud models need an Ollama account — run %sollama signin%s in a terminal, then retry.\n\n",
			CYellow, CReset, CCyan, CReset)
	case strings.Contains(low, "connection refused") || strings.Contains(low, "no such host") ||
		strings.Contains(low, "dial ") || strings.Contains(low, "timeout") || strings.Contains(low, "deadline"):
		fmt.Printf("%sHint:%s Can't reach Ollama on %s. Is it running? Launch it from your menu bar.\n\n",
			CYellow, CReset, OllamaHost)
	default:
		fmt.Printf("\n")
	}
}

func printHelp() {
	fmt.Printf("\n%sBandit CLI Commands:%s\n"+
		"  %s/help%s            Display this instruction index\n"+
		"  %s/clear%s           Wipe logs and clear chat history in the current session\n"+
		"  %s/new%s             Start a new session (saves the current one first)\n"+
		"  %s/sessions%s        List all saved sessions\n"+
		"  %s/load <idx>%s      Resume a saved session\n"+
		"  %s/persona <name>%s Switch persona (%shacker, philosopher, standard%s)\n"+
		"  %s/models%s          List installed models (numbered, active marked)\n"+
		"  %s/model <n|name>%s  Swap the active LLM (e.g. /model 2 or /model gemma4:e4b)\n"+
		"  %s/cloud [name]%s    Browse Ollama cloud models (needs 'ollama signin')\n"+
		"  %s/pull <name>%s     Download a new model from the Ollama registry\n"+
		"  %s/temp <val>%s      Get/Set LLM temperature (0.0 to 2.0)\n"+
		"  %s/top_p <val>%s     Get/Set LLM top_p (0.0 to 1.0)\n"+
		"  %s/ctx <val>%s       Get/Set LLM context length in tokens\n"+
		"  %s/exit%s            Shutdown Bandit CLI and return to shell\n\n",
		CYellow, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CGray, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset, CMagenta, CReset)
}

func saveCurrentSession() {
	if currentSession == nil {
		return
	}

	title := "New Scavenge Session"
	for _, m := range messages {
		if m.Role == "user" {
			title = m.Content
			if len(title) > 30 {
				title = title[:30] + "..."
			}
			break
		}
	}

	sysPrompt := ""
	if activePreset == "custom" {
		sysPrompt = customPromptText
	} else {
		sysPrompt = PersonalityPresets[activePreset].Prompt
	}

	currentSession.Title = title
	currentSession.Messages = messages
	currentSession.SystemPrompt = sysPrompt
	currentSession.Model = currentModel
	currentSession.Temperature = temperature
	currentSession.TopP = topP
	currentSession.NumCtx = numCtx

	if err := saveSession(currentSession); err != nil {
		fmt.Fprintf(os.Stderr, "\n%sWARNING:%s Failed to save session: %s\n\n", CRed+CBright, CReset, err)
	}
}

func startNewSession() {
	if currentSession != nil && len(messages) > 0 {
		saveCurrentSession()
	}

	currentSessionID := fmt.Sprintf("chat-%d-%s", time.Now().UnixNano()/int64(time.Millisecond), randomHex(4))
	messages = []Message{}

	sysPrompt := ""
	if activePreset == "custom" {
		sysPrompt = customPromptText
	} else {
		sysPrompt = PersonalityPresets[activePreset].Prompt
	}

	if sysPrompt != "" {
		messages = append(messages, Message{Role: "system", Content: sysPrompt})
	}

	currentSession = &Session{
		ID:           currentSessionID,
		Title:        "New Scavenge Session",
		Messages:     messages,
		SystemPrompt: sysPrompt,
		Model:        currentModel,
		Temperature:  temperature,
		TopP:         topP,
		NumCtx:       numCtx,
		CreatedAt:    time.Now().UnixNano() / int64(time.Millisecond),
	}

	saveCurrentSession()
}

func startupLoadSession() {
	sessions, err := listSessions()
	if err == nil && len(sessions) > 0 {
		s, err := loadSession(sessions[0].ID)
		if err == nil {
			currentSession = s
			messages = s.Messages
			currentModel = s.Model
			temperature = s.Temperature
			topP = s.TopP
			numCtx = s.NumCtx

			activePreset = "custom"
			for key, val := range PersonalityPresets {
				if val.Prompt == s.SystemPrompt {
					activePreset = key
					break
				}
			}
			if activePreset == "custom" {
				customPromptText = s.SystemPrompt
			} else {
				customPromptText = ""
			}
			return
		}
	}

	startNewSession()
}

func printSessionsList() {
	sessions, err := listSessions()
	if err != nil || len(sessions) == 0 {
		fmt.Printf("\n%sNo saved sessions found.%s\n\n", CYellow, CReset)
		return
	}

	fmt.Printf("\n%s%sSaved Scavenge Sessions:%s\n", CCyan, CBright, CReset)
	for idx, s := range sessions {
		isCurrent := " "
		if currentSession != nil && s.ID == currentSession.ID {
			isCurrent = "\x1b[32m*\x1b[0m"
		}

		t := time.Unix(s.CreatedAt/1000, (s.CreatedAt%1000)*1000000)
		dateStr := t.Format("2006-01-02 15:04:05")

		fmt.Printf("  [%d] %s %s%-30s%s (%s) - %s%s%s\n", idx+1, isCurrent, CYellow, s.Title, CReset, s.Model, CGray, dateStr, CReset)
	}
	fmt.Println()
}

func handleLoadCommand(arg string) {
	if arg == "" {
		fmt.Printf("\n%sUsage: /load <number_or_id>%s\n\n", CRed, CReset)
		return
	}

	sessions, err := listSessions()
	if err != nil || len(sessions) == 0 {
		fmt.Printf("\n%sNo saved sessions found to load.%s\n\n", CRed, CReset)
		return
	}

	var targetSessionID string
	var index int
	_, err = fmt.Sscanf(arg, "%d", &index)
	if err == nil && index >= 1 && index <= len(sessions) {
		targetSessionID = sessions[index-1].ID
	} else {
		for _, s := range sessions {
			if s.ID == arg {
				targetSessionID = s.ID
				break
			}
		}
	}

	if targetSessionID == "" {
		fmt.Printf("\n%sSession not found: %s%s\n\n", CRed, arg, CReset)
		return
	}

	s, err := loadSession(targetSessionID)
	if err != nil {
		fmt.Printf("\n%sFailed to load session details.%s\n\n", CRed, CReset)
		return
	}

	saveCurrentSession()

	currentSession = s
	messages = s.Messages
	currentModel = s.Model
	temperature = s.Temperature
	topP = s.TopP
	numCtx = s.NumCtx

	activePreset = "custom"
	for key, val := range PersonalityPresets {
		if val.Prompt == s.SystemPrompt {
			activePreset = key
			break
		}
	}
	if activePreset == "custom" {
		customPromptText = s.SystemPrompt
	} else {
		customPromptText = ""
	}

	clearScreen()
	fmt.Print(getAsciiArt(currentModel))
	fmt.Printf("%sBandit:%s Loaded session: %s%s%s\n", CGreen, CReset, CYellow, currentSession.ID, CReset)

	var listMsgs []Message
	for _, m := range messages {
		if m.Role != "system" {
			listMsgs = append(listMsgs, m)
		}
	}

	fmt.Printf("History contains %s%d%s messages.\n\n", CYellow, len(listMsgs), CReset)

	if len(listMsgs) > 0 {
		fmt.Printf("%s--- Last messages from history ---%s\n", CGray, CReset)
		start := len(listMsgs) - 5
		if start < 0 {
			start = 0
		}
		for _, m := range listMsgs[start:] {
			if m.Role == "user" {
				fmt.Printf("%s%sYou:%s %s\n\n", CMagenta, CBright, CReset, m.Content)
			} else {
				fmt.Printf("%s%sBandit:%s %s\n\n", CGreen, CBright, CReset, ColorizeMarkdown(m.Content))
			}
		}
		fmt.Printf("%s----------------------------------%s\n\n", CGray, CReset)
	}
}

func main() {
	clearScreen()

	_, _ = ensureSessionsDir()
	startupLoadSession()

	fmt.Print(getAsciiArt(currentModel))

	if currentSession != nil && len(messages) > 1 {
		fmt.Printf("%sBandit:%s Resumed previous session: %s%s%s\n\n", CGreen, CReset, CYellow, currentSession.ID, CReset)
	}

	availableModels, err := verifyOllama()
	if err != nil {
		fmt.Printf("%sWARNING:%s Cannot ping local Ollama instance on %s.\n", CRed+CBright, CReset, OllamaHost)
		fmt.Println("\n=== How to install and launch Ollama ===")
		fmt.Printf("1. Download Ollama from: %shttps://ollama.com%s\n", CCyan, CReset)
		fmt.Println("2. Install and launch the application.")
		fmt.Println("3. Once Ollama is running in your menu bar, rerun this tool!")
	} else if len(availableModels) == 0 {
		fmt.Printf("%sWARNING:%s No AI models found in your local Ollama registry.\n", CRed+CBright, CReset)
		fmt.Println("\n=== How to download a model to use with Bandit ===")
		fmt.Println("1. You can download a model directly in this CLI using:")
		fmt.Printf("   %s/pull gemma4:e2b%s  (downloads our recommended 1.6B model)\n", CGreen, CReset)
		fmt.Println("2. Alternatively, run this command in a separate terminal window:")
		fmt.Printf("   %sollama run gemma4:e2b%s\n", CCyan, CReset)
		fmt.Println("3. Once the download begins or completes, you can chat with Bandit!")
	} else {
		found := false
		for _, m := range availableModels {
			if m == currentModel {
				found = true
				break
			}
		}

		if !found {
			alternative := ""
			for _, m := range availableModels {
				if strings.Contains(m, "gemma4") {
					alternative = m
					break
				}
			}

			if alternative != "" {
				currentModel = alternative
				fmt.Printf("%sDefaulting to installed model: %s%s\n\n", CGray, CYellow+currentModel+CReset, CGray)
				saveCurrentSession()
			} else {
				fallbackModel := availableModels[0]
				fmt.Printf("%sWARNING:%s Recommended model '%s' not found in Ollama.\n", CYellow, CReset, currentModel)
				fmt.Printf("%sDefaulting to installed model: %s%s\n\n", CGray, CYellow+fallbackModel+CReset, CGray)
				currentModel = fallbackModel
				saveCurrentSession()
			}
		}
	}

	reader := bufio.NewReader(os.Stdin)

	for {
		fmt.Printf("%s%sYou>%s ", CMagenta, CBright, CReset)
		input, err := reader.ReadString('\n')
		if err == io.EOF {
			fmt.Printf("\n\n%sBandit:%s Heading back into the vents. Keep it clean! 🦝🚪\n\n", CGreen, CReset)
			os.Exit(0)
		}
		if err != nil {
			continue
		}

		trimmed := strings.TrimSpace(input)
		if trimmed == "" {
			continue
		}

		if strings.HasPrefix(trimmed, "/") {
			parts := strings.SplitN(trimmed, " ", 2)
			command := strings.ToLower(parts[0])
			arg := ""
			if len(parts) > 1 {
				arg = strings.TrimSpace(parts[1])
			}

			if command == "/exit" {
				fmt.Printf("\n%sBandit:%s Heading back into the vents. Keep it clean! 🦝🚪\n\n", CGreen, CReset)
				os.Exit(0)
			}

			if command == "/clear" {
				messages = []Message{}
				sysPrompt := ""
				if activePreset == "custom" {
					sysPrompt = customPromptText
				} else {
					sysPrompt = PersonalityPresets[activePreset].Prompt
				}
				if sysPrompt != "" {
					messages = append(messages, Message{Role: "system", Content: sysPrompt})
				}
				saveCurrentSession()
				clearScreen()
				fmt.Print(getAsciiArt(currentModel))
				fmt.Printf("%sBandit:%s Current session's trash log completely emptied!\n\n", CGreen, CReset)
				continue
			}

			if command == "/new" {
				startNewSession()
				fmt.Printf("\n%sBandit:%s Saved current session and initialized a new one! 🦝✨\n\n", CGreen, CReset)
				continue
			}

			if command == "/sessions" {
				printSessionsList()
				continue
			}

			if command == "/load" {
				handleLoadCommand(arg)
				continue
			}

			if command == "/persona" {
				if arg == "" {
					fmt.Printf("\n%sCurrent Persona:%s %s%s%s (%s)\n", CCyan, CReset, CYellow, activePreset, CReset, PersonalityPresets[activePreset].Name)
					fmt.Printf("%sDescription:%s %s\n", CGray, CReset, PersonalityPresets[activePreset].Description)
					fmt.Printf("\n%sAvailable Personas:%s\n", CCyan, CReset)
					presetsOrder := []string{"hacker", "philosopher", "standard"}
					for _, key := range presetsOrder {
						val := PersonalityPresets[key]
						fmt.Printf("  %s%s%s - %s (%s%s%s)\n", CMagenta, key, CReset, val.Name, CGray, val.Description, CReset)
					}
					fmt.Printf("\nUse %s/persona <name>%s to swap.\n\n", CMagenta, CReset)
				} else {
					target := strings.ToLower(arg)
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
						fmt.Printf("\n%sBandit:%s Persona swapped to %s%s%s!\n\n", CGreen, CReset, CYellow, PersonalityPresets[target].Name, CReset)
					} else {
						fmt.Printf("\n%sUnknown persona: %s. Type /persona for options.%s\n\n", CRed, target, CReset)
					}
				}
				continue
			}

			if command == "/models" {
				printModelsList()
				continue
			}

			if command == "/model" {
				if arg == "" {
					fmt.Printf("\nActive model: %s%s%s\n", CYellow, currentModel, CReset)
					printModelsList()
				} else {
					target := resolveModelArg(arg)
					if !modelNameRegex.MatchString(target) {
						fmt.Printf("\n%sInvalid model name. Use only letters, numbers, :, _, ., /, -%s\n\n", CRed, CReset)
						continue
					}
					availableModels, _ := verifyOllama()
					found := false
					for _, m := range availableModels {
						if m == target {
							found = true
							break
						}
					}
					currentModel = target
					saveCurrentSession()
					if !found {
						fmt.Printf("\n%sBandit:%s Active LLM swapped to: %s%s%s\n%sNote:%s not installed locally — run %s/pull %s%s first, or %s/cloud%s to browse cloud models.\n\n",
							CGreen, CReset, CYellow, currentModel, CReset, CYellow, CReset, CMagenta, currentModel, CReset, CMagenta, CReset)
					} else {
						fmt.Printf("\n%sBandit:%s Active LLM swapped to: %s%s%s\n\n", CGreen, CReset, CYellow, currentModel, CReset)
					}
				}
				continue
			}

			if command == "/cloud" {
				if arg == "" {
					printCloudCatalog()
				} else {
					if !modelNameRegex.MatchString(arg) {
						fmt.Printf("\n%sInvalid model name. Use only letters, numbers, :, _, ., /, -%s\n\n", CRed, CReset)
						continue
					}
					printCloudTags(arg)
				}
				continue
			}

			if command == "/pull" {
				if arg == "" {
					fmt.Printf("\n%sUsage: /pull <model_name>%s\n\n", CRed, CReset)
				} else {
					err := pullModel(context.Background(), arg)
					if err != nil {
						fmt.Printf("\n%sError pulling model: %s%s\n\n", CRed, err, CReset)
					}
				}
				continue
			}

			if command == "/temp" {
				if arg == "" {
					fmt.Printf("\nTemperature: %s%.1f%s (default: 0.7)\n\n", CYellow, temperature, CReset)
				} else {
					var val float64
					_, err := fmt.Sscanf(arg, "%f", &val)
					if err != nil || val < 0.0 || val > 2.0 {
						fmt.Printf("\n%sInvalid temperature value. Must be a number between 0.0 and 2.0.%s\n\n", CRed, CReset)
					} else {
						temperature = val
						saveCurrentSession()
						fmt.Printf("\n%sBandit:%s Temperature set to %s%.1f%s\n\n", CGreen, CReset, CYellow, temperature, CReset)
					}
				}
				continue
			}

			if command == "/top_p" {
				if arg == "" {
					fmt.Printf("\nTop_p: %s%.1f%s (default: 0.9)\n\n", CYellow, topP, CReset)
				} else {
					var val float64
					_, err := fmt.Sscanf(arg, "%f", &val)
					if err != nil || val < 0.0 || val > 1.0 {
						fmt.Printf("\n%sInvalid top_p value. Must be a number between 0.0 and 1.0.%s\n\n", CRed, CReset)
					} else {
						topP = val
						saveCurrentSession()
						fmt.Printf("\n%sBandit:%s Top_p set to %s%.1f%s\n\n", CGreen, CReset, CYellow, topP, CReset)
					}
				}
				continue
			}

			if command == "/ctx" {
				if arg == "" {
					fmt.Printf("\nContext Size (num_ctx): %s%d%s tokens (default: 2048)\n\n", CYellow, numCtx, CReset)
				} else {
					var val int
					_, err := fmt.Sscanf(arg, "%d", &val)
					if err != nil || val < 256 || val > 131072 {
						fmt.Printf("\n%sInvalid context size. Must be an integer between 256 and 131072.%s\n\n", CRed, CReset)
					} else {
						numCtx = val
						saveCurrentSession()
						fmt.Printf("\n%sBandit:%s Context size set to %s%d%s tokens\n\n", CGreen, CReset, CYellow, numCtx, CReset)
					}
				}
				continue
			}

			if command == "/help" {
				printHelp()
				continue
			}

			fmt.Printf("\n%sUnknown command: %s. Type /help for assistance.%s\n\n", CRed, command, CReset)
			continue
		}

		messages = append(messages, Message{Role: "user", Content: trimmed})
		saveCurrentSession()

		formatter := NewMarkdownFormatter()
		accumulated, err := chatStream(context.Background(), currentSession, formatter)
		if err != nil {
			printChatError(err)
			messages = messages[:len(messages)-1]
			saveCurrentSession()
		} else {
			messages = append(messages, Message{Role: "assistant", Content: accumulated})
			saveCurrentSession()
		}
	}
}
