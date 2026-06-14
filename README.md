# 🦝 Bandit AI: Retro Cyber-Raccoon Chatbot (CLI & Web UI)

> *"One person's digital garbage is another raccoon's prized codebase."*

> [!NOTE]
> **Development Status:** Bandit AI is currently in **very early development**. Expect occasional bugs, experimental terminal commands, and rough edges as we chitter along and scavenge for better code scraps!

Welcome to **Bandit AI**, a retro cyberpunk-themed local chatbot with a split personality. Bandit exists in two environments: a neon-colored **Interactive CLI** and a retro-futuristic **React Web Interface**. He runs entirely on your local machine using **Ollama**, ensuring your scavenged chats never leave your hard drive.

---

## 🎭 Meet Bandit (The AI Personality)

Bandit is not your typical polite, sterile AI assistant. Depending on his active configuration, he adopts one of three distinct personas:

| Persona | Alias | Character Description |
| :--- | :--- | :--- |
| **Cynical Cyber-Raccoon** | `hacker` | Sarcastic, cynical, and highly technically competent. Bandit makes frequent raccoon metaphors (about garbage cans, washing digital food, shiny trinkets, nocturnal adventures, and escaping through vents). |
| **Garbage Philosopher** | `philosopher` | Deep-thinking and existential. He views the universe as one giant cosmic trash can and frames all wisdom around searching for delicious digital leftovers. |
| **Smart Assistant** | `standard` | Polite, brilliant, structured, and helpful. (A standard assistant profile for when you just want clean, distraction-free technical help). |

---

## ⚡ Prerequisites: Setting Up Your Local LLM with Ollama

Bandit depends on **Ollama** to run models locally on your system.

### 1. Download & Install Ollama
Go to [Ollama.com](https://ollama.com) to download and install the Ollama client for your operating system (macOS, Windows, or Linux).

### 2. Start the Ollama Service
Make sure the Ollama application is open and running in the background. You can verify it is active by checking your menu bar or system tray.

### 3. Pull a Model
Bandit defaults to whatever model you have installed. You can download a model through your terminal:
```bash
ollama pull *insert model name here*
```
*(Alternatively, you can pull models directly inside the Bandit CLI using the `/pull <model_name>` command).*

---

## 🚀 Getting Started

Clone this repository and install its dependencies to fire up Bandit:

```bash
# Clone the repository
git clone https://github.com/<your-username>/bandit_ai.git
cd bandit_ai

# Install dependencies
npm install
```

### Option A: The Cyberpunk Terminal CLI 💻
Run Bandit right in your shell with a full retro ASCII raccoon face, colored stream formatting, and custom system-level controls:

```bash
# Start the CLI
npm run cli
```

#### Link Globally (Optional)
You can link the binary globally to run `bandit` from any directory in your terminal:
```bash
# Link the CLI script globally
npm link

# Run Bandit anytime, anywhere
bandit
```

### Option B: Standalone Desktop App (macOS DMG) 🖥️
The easiest way to run Bandit AI on macOS is to download the standalone desktop application:

1. Download the latest `Bandit_AI_v0.1.1.dmg` setup package from the [Releases](https://github.com/BitsOfJT/bandit-ai/releases) page.
2. Double-click the `.dmg` file to mount it.
3. Drag **Bandit AI** directly into your **Applications** folder.
4. Launch **Bandit AI** from your Applications or Launchpad! *(It will automatically handle running the local Vite server and connecting to Ollama in the background)*.

---

### Option C: Manual Web UI Build 🌐
If you prefer to build the interface manually or run it in a browser:

```bash
# Start the local Vite server
npm run dev
```
Then navigate to the local server port displayed in your terminal (usually [http://localhost:5173](http://localhost:5173)).

> **Note:** The web UI's `/api` calls are proxied to Ollama by the Vite dev server. For production builds (`npm run build` + `npm run preview`), you must configure a reverse proxy (nginx, Caddy, etc.) to forward `/api/*` to `http://127.0.0.1:11434`.

---

## 🕹️ CLI Commands Cheat Sheet

While talking to Bandit in the CLI, use these slash commands to interact with the LLM or customize your session:

| Command | Action |
| :--- | :--- |
| `/help` | Displays the command help menu. |
| `/persona <name>` | Swaps active persona between `hacker`, `philosopher`, or `standard`. |
| `/model <name>` | Swaps active model loaded in Ollama (e.g., `/model llama3`). |
| `/pull <name>` | Downloads/pulls a new model directly from the Ollama registry. |
| `/sessions` | Lists all your saved scavenger chat sessions. |
| `/load <idx>` | Resumes a saved chat session by index number. |
| `/new` | Saves current history and starts a fresh new chat session. |
| `/clear` | Wipes the current chat history but keeps the session active. |
| `/temp <val>` | Get/Set LLM temperature (`0.0` to `2.0` - defaults to `0.7`). |
| `/top_p <val>` | Get/Set LLM top_p sampling (`0.0` to `1.0` - defaults to `0.9`). |
| `/ctx <val>` | Get/Set LLM context token length (defaults to `2048`). |
| `/exit` | Gracefully shut down Bandit CLI and exit back to terminal. |

---

## 📂 Session Architecture
All session data from your CLI runs are stored locally on your machine at:
`~/.bandit_ai/sessions/`

Web interface sessions are stored securely in your browser's local storage (`localStorage`), so they persist across browser tabs.

---

## 🛠️ Tech Stack
- **CLI Core**: Go (compiled binary), native standard streams, and colorized ANSI streams.
- **Frontend App**: React (TypeScript), Vite, CSS Variables, Lucide icons, and modern viewport layouts.
- **Local Engine**: Ollama HTTP API (`http://127.0.0.1:11434`).

---

## 🧪 Running Tests

```bash
npm test            # Run TypeScript/React unit tests (Vitest)
npm run test:watch  # Run tests in watch mode
cd cli-go && go test ./... -v  # Run Go CLI tests
```

---

*Scavenge responsibly!* 🦝💾
# bandit-ai
