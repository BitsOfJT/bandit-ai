#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';

const OLLAMA_HOST = 'http://127.0.0.1:11434';
const SESSIONS_DIR = path.join(os.homedir(), '.bandit_ai', 'sessions');

let currentModel = 'gemma4:e2b';
let temperature = 0.7;
let topP = 0.9;
let numCtx = 2048;
let activePreset = 'hacker';
let customPromptText = '';
let currentSessionId = '';
let messages = [];

// Cyberpunk ANSI Colors
const C_RESET = '\x1b[0m';
const C_BRIGHT = '\x1b[1m';
const C_GREEN = '\x1b[32m';
const C_MAGENTA = '\x1b[35m';
const C_CYAN = '\x1b[36m';
const C_YELLOW = '\x1b[33m';
const C_RED = '\x1b[31m';
const C_GRAY = '\x1b[90m';

const PERSONALITY_PRESETS = {
  hacker: {
    name: 'Cynical Cyber-Raccoon',
    prompt: 'You are Bandit, a sarcastic cyber-raccoon AI hacker in a terminal interface. You love terminal commands, shiny electronic parts, hacking code, and eating digital garbage. You use raccoon metaphors often (referencing garbage cans, washing food, shiny objects, nocturnal adventures) and have a cynical, witty, but ultimately helpful hacker personality.',
    description: 'Witty hacker with raccoon energy'
  },
  philosopher: {
    name: 'Garbage Philosopher',
    prompt: 'You are Bandit, a deep-thinking raccoon philosopher. You believe that the universe is one giant cosmic trash can, and we are all just searching for delicious leftovers. Frame answers with philosophical musings, existential humor, and raccoon wisdom.',
    description: 'Existential musings and trash wisdom'
  },
  standard: {
    name: 'Smart Assistant',
    prompt: 'You are Bandit, a helpful, brilliant AI assistant. Answer the user comprehensively, structure your responses cleanly, and explain technical topics clearly.',
    description: 'Helpful and polite technical helper'
  }
};

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getAsciiArt(modelName) {
  return `
${C_CYAN}${C_BRIGHT}
  .--------------------------------------------------.
  |      ${C_GREEN}BANDIT AI v0.4: RETRO CYBER-RACCOON CLI${C_CYAN}       |
  |            [SYSTEM: OLLAMA CONNECTED]            |
  '--------------------------------------------------'
${C_RESET}
  ${C_GRAY}##################################################${C_RESET}
  ${C_GRAY}++++++++++++++++++++++++++++++++++++++++++++++++++${C_RESET}
  ${C_GRAY}+''''''''''''''''''''''''''''''''''''''''''''''''+${C_RESET}
  ${C_GRAY}+''''''''''''''''''''''''''''''''''''''''''''''''+${C_RESET}
  ${C_GRAY}+'''''''''''''''''''''''''''''''''''''''''''''''''${C_RESET}
  ${C_GRAY}+''''''+++#_#+''''''''''''''''''|''++_###+'''''''+${C_RESET}
  ${C_GRAY}+'''''++#----_+'''''''''''''''''|'++_----#+''''''+${C_RESET}
  ${C_GRAY}+'''''+######_##_'''''''''''''''++#_#######'''''++${C_RESET}
  ${C_GRAY}+'''''####+#######++#########_++#######+##+#''''+#${C_RESET}
  ${C_GRAY}+'''''###++_#-##_###----##----######+#_+-#.#''''++${C_RESET}
  ${C_GRAY}+----+###+++##########################++-#-#----++${C_RESET}
  ${C_GRAY}+-----###++-###_####+++####+++########++##-#----++${C_RESET}
  ${C_GRAY}+-----#_##+++####-++##+###++#-++-####+++###-----++${C_RESET}
  ${C_GRAY}+----+-###+-+_#_++###_#+#-#####+++#_+++####-----++${C_RESET}
  ${C_GRAY}+-----++###++#++###-#########--###++#++###+++----+${C_RESET}
  ${C_GRAY}+------####-#-+-######+#++#+###-#-++-###+#-#----++${C_RESET}
  ${C_GRAY}+-----+######+##########+###########+#####++----+#${C_RESET}
  ${C_GRAY}+---#######+############++############+#######--++${C_RESET}
  ${C_GRAY}+---++#+###++####+++####++##+#+++####++###++++--++${C_RESET}
  ${C_GRAY}+---++###++############################++##+#---+#${C_RESET}
  ${C_GRAY}+-----############++--+#+++#####++--+#+######---++${C_RESET}
  ${C_GRAY}+-----###+##+##+++#+--++##+##+###+--+###+#+#+---+-${C_RESET}
  ${C_GRAY}+---+##########+####+#++#-+##+###+-++########+--++${C_RESET}
  ${C_GRAY}+--+#####+++#+#-+##+##+####+++##++##+#+++#####+-++${C_RESET}
  ${C_GRAY}+--####-###-#++######+#-####+######-#+-###-#+#--+#${C_RESET}
  ${C_GRAY}+--####-+++-+#######+########+#######+-+++####--++${C_RESET}
  ${C_GRAY}+---######++#####++############++####+++#####+--++${C_RESET}
  ${C_GRAY}+----########+++##################+++#######----++${C_RESET}
  ${C_GRAY}+----+#####++++####################++++#####----++${C_RESET}
  ${C_GRAY}+-----+####################################+----++${C_RESET}
  ${C_GRAY}+-------###+###++##-#-#####++####+####+##+------++${C_RESET}
  ${C_GRAY}+-------++##########+###################+#------++${C_RESET}
  ${C_GRAY}+-------##+++#################+######++##+------+#${C_RESET}
  ${C_GRAY}+-----------#+-++-##+++++++++-###+++#+----------+#${C_RESET}
  ${C_GRAY}+-----------+++++++###########+##+-##+----------++${C_RESET}
  ${C_GRAY}+---------------------++++++#+-###+----#--------++${C_RESET}
  ${C_GRAY}+--------------------------+#---+++--------------+${C_RESET}
  ${C_GRAY}+--------------------------##--------------------+${C_RESET}
  ${C_GRAY}+------------------------------------------------+${C_RESET}
  ${C_GRAY}+------------------------------------------------+${C_RESET}
  ${C_GRAY}++++++++++++++++++++++++++++++++++++++++++++++++++${C_RESET}
  ${C_GRAY}+#################################################${C_RESET}

  ${C_RESET}${C_BRIGHT}Active Model:${C_RESET} ${C_YELLOW}${C_BRIGHT}${modelName}${C_RESET} | ${C_BRIGHT}Status:${C_RESET} ${C_GREEN}READY FOR SCAVENGING${C_RESET}
  ${C_BRIGHT}Commands:${C_RESET} ${C_MAGENTA}/exit${C_RESET}, ${C_MAGENTA}/clear${C_RESET}, ${C_MAGENTA}/new${C_RESET}, ${C_MAGENTA}/sessions${C_RESET}, ${C_MAGENTA}/load${C_RESET}, ${C_MAGENTA}/persona${C_RESET}, ${C_MAGENTA}/model${C_RESET}, ${C_MAGENTA}/pull${C_RESET}, ${C_MAGENTA}/help${C_RESET}
`;
}

function printHelp() {
  console.log(`
${C_YELLOW}Bandit CLI Commands:${C_RESET}
  ${C_MAGENTA}/help${C_RESET}            Display this instruction index
  ${C_MAGENTA}/clear${C_RESET}           Wipe logs and clear chat history in the current session
  ${C_MAGENTA}/new${C_RESET}             Start a new session (saves the current one first)
  ${C_MAGENTA}/sessions${C_RESET}        List all saved sessions
  ${C_MAGENTA}/load <idx>${C_RESET}      Resume a saved session
  ${C_MAGENTA}/persona <name>${C_RESET} Switch persona (${C_GRAY}hacker, philosopher, standard${C_RESET})
  ${C_MAGENTA}/model <name>${C_RESET}    Swap the active LLM (e.g. /model gemma4:e4b)
  ${C_MAGENTA}/pull <name>${C_RESET}     Download a new model from the Ollama registry
  ${C_MAGENTA}/temp <val>${C_RESET}      Get/Set LLM temperature (0.0 to 2.0)
  ${C_MAGENTA}/top_p <val>${C_RESET}     Get/Set LLM top_p (0.0 to 1.0)
  ${C_MAGENTA}/ctx <val>${C_RESET}       Get/Set LLM context length in tokens
  ${C_MAGENTA}/exit${C_RESET}            Shutdown Bandit CLI and return to shell
`);
}

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function saveSession() {
  if (!currentSessionId) {
    currentSessionId = `chat-${Date.now()}`;
  }
  ensureSessionsDir();
  
  let title = 'New Scavenge Session';
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    title = firstUserMsg.content.substring(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
  }

  const sessionData = {
    id: currentSessionId,
    title: title,
    messages: messages,
    systemPrompt: PERSONALITY_PRESETS[activePreset]?.prompt || customPromptText || PERSONALITY_PRESETS.hacker.prompt,
    model: currentModel,
    temperature: temperature,
    top_p: topP,
    num_ctx: numCtx,
    createdAt: currentSessionId.startsWith('chat-') ? parseInt(currentSessionId.split('-')[1]) : Date.now()
  };

  const filePath = path.join(SESSIONS_DIR, `${currentSessionId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
}

function loadSession(sessionId) {
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    currentSessionId = data.id;
    messages = data.messages || [];
    currentModel = data.model || currentModel;
    temperature = data.temperature ?? temperature;
    topP = data.top_p ?? topP;
    numCtx = data.num_ctx ?? numCtx;
    
    let matchedPreset = 'custom';
    for (const [key, value] of Object.entries(PERSONALITY_PRESETS)) {
      if (value.prompt === data.systemPrompt) {
        matchedPreset = key;
        break;
      }
    }
    activePreset = matchedPreset;
    if (matchedPreset === 'custom') {
      customPromptText = data.systemPrompt || '';
    } else {
      customPromptText = '';
    }
    return true;
  } catch (e) {
    return false;
  }
}

function startNewSession() {
  if (currentSessionId && messages.length > 0) {
    saveSession();
  }
  currentSessionId = `chat-${Date.now()}`;
  messages = [];
  const sysPrompt = activePreset === 'custom' ? customPromptText : PERSONALITY_PRESETS[activePreset].prompt;
  messages.push({ role: 'system', content: sysPrompt });
  saveSession();
}

function listSessions() {
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log(`\n${C_YELLOW}No saved sessions found.${C_RESET}\n`);
    return [];
  }
  
  const sessions = [];
  for (const file of files) {
    try {
      const filePath = path.join(SESSIONS_DIR, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      sessions.push(data);
    } catch (e) {}
  }
  
  sessions.sort((a, b) => b.createdAt - a.createdAt);
  
  console.log(`\n${C_CYAN}${C_BRIGHT}Saved Scavenge Sessions:${C_RESET}`);
  sessions.forEach((s, idx) => {
    const isCurrent = s.id === currentSessionId ? `${C_GREEN}*${C_RESET}` : ' ';
    const dateStr = new Date(s.createdAt).toLocaleString();
    console.log(`  [${idx + 1}] ${isCurrent} ${C_YELLOW}${s.title.padEnd(30)}${C_RESET} (${s.model}) - ${C_GRAY}${dateStr}${C_RESET}`);
  });
  console.log();
  return sessions;
}

function colorizeMarkdown(text) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  
  return parts.map((part) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const match = part.match(/^```(\w*)\n([\s\S]*?)```$/);
      if (match) {
        const lang = match[1] || 'code';
        const code = match[2];
        const lines = code.split('\n');
        if (lines.length > 0 && lines[lines.length - 1] === '') {
          lines.pop();
        }
        const formattedLines = lines.map(line => `  ${C_GRAY}│${C_RESET}  ${C_GREEN}${line}${C_RESET}`);
        const header = `  ${C_GRAY}┌── ${C_CYAN}${C_BRIGHT}${lang.toUpperCase()}${C_RESET}${C_GRAY} ──────────────────────────────────────────${C_RESET}`;
        const footer = `  ${C_GRAY}└──────────────────────────────────────────────────${C_RESET}`;
        return `\n${header}\n${formattedLines.join('\n')}\n${footer}\n`;
      }
      return part;
    } else {
      let formatted = part;
      // Convert bold **text** to bright white/bold while preserving surrounding cyan
      formatted = formatted.replace(/\*\*(.*?)\*\*/g, `${C_BRIGHT}$1${C_RESET}${C_CYAN}`);
      // Convert inline `code` to yellow while preserving surrounding cyan
      formatted = formatted.replace(/`(.*?)`/g, `${C_YELLOW}$1${C_RESET}${C_CYAN}`);
      
      const lines = formatted.split('\n');
      const processedLines = lines.map(line => {
        const bulletMatch = line.match(/^(\s*)([-*+])\s(.*)$/);
        if (bulletMatch) {
          const indent = bulletMatch[1];
          const content = bulletMatch[3];
          return `${indent}  ${C_YELLOW}•${C_RESET} ${C_CYAN}${content}`;
        }
        return line;
      });
      
      return processedLines.join('\n');
    }
  }).join('');
}

async function verifyOllama() {
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/tags`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const models = data.models || [];
    return models.map(m => m.name);
  } catch (e) {
    return null;
  }
}

async function pullModel(modelName) {
  console.log(`\n${C_GREEN}Bandit:${C_RESET} Connecting to Ollama to pull ${C_YELLOW}${modelName}${C_RESET}...`);
  try {
    const response = await fetch(`${OLLAMA_HOST}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.statusText} (${response.status})`);
    }

    if (!response.body) {
      throw new Error('No response body stream.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const status = parsed.status;
          const completed = parsed.completed || 0;
          const total = parsed.total || 0;
          
          if (total > 0) {
            const percent = Math.round((completed / total) * 100);
            const barLength = 30;
            const filledLength = Math.round((completed / total) * barLength);
            const bar = '='.repeat(filledLength) + ' '.repeat(barLength - filledLength);
            const compGB = (completed / 1024 / 1024 / 1024).toFixed(2);
            const totalGB = (total / 1024 / 1024 / 1024).toFixed(2);
            process.stdout.write(`\r${C_CYAN}Downloading [${bar}] ${percent}% (${compGB}GB / ${totalGB}GB)${C_RESET}`);
          } else {
            process.stdout.write(`\r${C_GRAY}Status: ${status}${' '.repeat(40)}${C_RESET}`);
          }
        } catch (e) {}
      }
    }
    console.log(`\n\n${C_GREEN}Bandit:${C_RESET} Model ${C_YELLOW}${modelName}${C_RESET} successfully installed! 🦝💾\n`);
  } catch (err) {
    console.log(`\n${C_RED}Error pulling model:${C_RESET} ${err.message}\n`);
  }
}

async function chatStream(prompt) {
  messages.push({ role: 'user', content: prompt });
  saveSession();

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: messages,
        options: { temperature: temperature, top_p: topP, num_ctx: numCtx },
        stream: true
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.statusText} (${response.status})`);
    }

    if (!response.body) {
      throw new Error('No stream body returned by Ollama.');
    }

    process.stdout.write(`\n${C_GREEN}${C_BRIGHT}Bandit:${C_RESET} ${C_CYAN}`);
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    // Streaming Markdown State
    let inCodeBlock = false;
    let inInlineCode = false;
    let inBold = false;
    let backtickCount = 0;
    let starCount = 0;
    let currentStyle = C_CYAN;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            const token = parsed.message.content;
            accumulated += token;
            
            // Process token character by character to handle formatting styles in real-time
            let output = '';
            for (let i = 0; i < token.length; i++) {
              const char = token[i];
              
              if (char === '`') {
                backtickCount++;
              } else {
                if (backtickCount === 1) {
                  inInlineCode = !inInlineCode;
                  currentStyle = inInlineCode ? C_YELLOW : C_CYAN;
                  output += `${C_RESET}${currentStyle}`;
                  backtickCount = 0;
                } else if (backtickCount === 3) {
                  inCodeBlock = !inCodeBlock;
                  if (inCodeBlock) {
                    output += `\n${C_GRAY}┌── CODE ──────────────────────────${C_RESET}\n${C_GREEN}`;
                    currentStyle = C_GREEN;
                  } else {
                    output += `\n${C_RESET}${C_GRAY}└──────────────────────────────────${C_RESET}\n${C_CYAN}`;
                    currentStyle = C_CYAN;
                  }
                  backtickCount = 0;
                } else if (backtickCount > 0) {
                  output += '`'.repeat(backtickCount);
                  backtickCount = 0;
                }
                
                if (char === '*') {
                  starCount++;
                } else {
                  if (starCount === 2) {
                    inBold = !inBold;
                    output += inBold ? C_BRIGHT : `${C_RESET}${currentStyle}`;
                    starCount = 0;
                  } else if (starCount === 1) {
                    output += '*';
                    starCount = 0;
                  }
                  output += char;
                }
              }
            }
            process.stdout.write(output);
          }
        } catch (err) {
          // Ignore partial parse failures
        }
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (parsed.message?.content) {
          accumulated += parsed.message.content;
          process.stdout.write(parsed.message.content);
        }
      } catch (err) {}
    }

    // Final flushes for trailing delimiters
    let finalFlush = '';
    if (backtickCount > 0) {
      if (backtickCount === 1) {
        inInlineCode = !inInlineCode;
        finalFlush += `${C_RESET}${inInlineCode ? C_YELLOW : C_CYAN}`;
      } else if (backtickCount === 3) {
        inCodeBlock = !inCodeBlock;
        if (inCodeBlock) {
          finalFlush += `\n${C_GRAY}┌── CODE ──────────────────────────${C_RESET}\n${C_GREEN}`;
        } else {
          finalFlush += `\n${C_RESET}${C_GRAY}└──────────────────────────────────${C_RESET}\n${C_CYAN}`;
        }
      } else {
        finalFlush += '`'.repeat(backtickCount);
      }
    }
    if (starCount > 0) {
      if (starCount === 2) {
        inBold = !inBold;
        finalFlush += inBold ? C_BRIGHT : `${C_RESET}${currentStyle}`;
      } else {
        finalFlush += '*';
      }
    }
    process.stdout.write(finalFlush);

    console.log(`${C_RESET}\n`);
    messages.push({ role: 'assistant', content: accumulated });
    saveSession();

  } catch (err) {
    console.log(`\n\n${C_RED}${C_BRIGHT}Error:${C_RESET} Failed to scan Ollama. Is it running? (${err.message})`);
    messages.pop();
    saveSession();
  }
}

async function startCLI() {
  console.clear();
  
  ensureSessionsDir();
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  let loaded = false;
  
  if (files.length > 0) {
    const sessions = [];
    for (const file of files) {
      try {
        const filePath = path.join(SESSIONS_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        sessions.push(data);
      } catch (e) {}
    }
    sessions.sort((a, b) => b.createdAt - a.createdAt);
    if (sessions.length > 0) {
      loadSession(sessions[0].id);
      loaded = true;
    }
  }

  if (!loaded) {
    startNewSession();
  }

  console.log(getAsciiArt(currentModel));
  
  if (loaded) {
    console.log(`${C_GREEN}Bandit:${C_RESET} Resumed previous session: ${C_YELLOW}${currentSessionId}${C_RESET}\n`);
  }

  const availableModels = await verifyOllama();
  if (!availableModels) {
    console.log(`${C_RED}${C_BRIGHT}WARNING:${C_RESET} Cannot ping local Ollama instance on ${OLLAMA_HOST}.`);
    console.log(`\n=== How to install and launch Ollama ===`);
    console.log(`1. Download Ollama from: ${C_CYAN}https://ollama.com${C_RESET}`);
    console.log(`2. Install and launch the application.`);
    console.log(`3. Once Ollama is running in your menu bar, rerun this script!\n`);
  } else if (availableModels.length === 0) {
    console.log(`${C_RED}${C_BRIGHT}WARNING:${C_RESET} No AI models found in your local Ollama registry.`);
    console.log(`\n=== How to download a model to use with Bandit ===`);
    console.log(`1. You can download a model directly in this CLI using:`);
    console.log(`   ${C_GREEN}/pull gemma4:e2b${C_RESET}  (downloads our recommended 1.6B model)`);
    console.log(`2. Alternatively, run this command in a separate terminal window:`);
    console.log(`   ${C_CYAN}ollama run gemma4:e2b${C_RESET}`);
    console.log(`3. Once the download begins or completes, you can chat with Bandit!\n`);
  } else if (!availableModels.includes(currentModel)) {
    const alternative = availableModels.find(m => m.includes('gemma4'));
    if (alternative) {
      currentModel = alternative;
      console.log(`${C_GRAY}Defaulting to installed model: ${C_YELLOW}${currentModel}${C_RESET}\n`);
      saveSession();
    } else {
      console.log(`${C_YELLOW}WARNING:${C_RESET} Recommended model '${currentModel}' not found in Ollama.`);
      console.log(`Available models: ${C_GRAY}${availableModels.join(', ')}${C_RESET}`);
      console.log(`You can run ${C_GREEN}/pull gemma4:e2b${C_RESET} to download the recommended model.\n`);
    }
  }

  askQuestion();
}

function askQuestion() {
  if (rl.closed) return;
  try {
    rl.question(`${C_MAGENTA}${C_BRIGHT}You>${C_RESET} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed.startsWith('/')) {
        const parts = trimmed.split(' ');
        const command = parts[0].toLowerCase();
        const arg = parts.slice(1).join(' ');

        if (command === '/exit') {
          console.log(`\n${C_GREEN}Bandit:${C_RESET} Heading back into the vents. Keep it clean! 🦝🚪\n`);
          rl.close();
          process.exit(0);
        }

        if (command === '/clear') {
          messages = [];
          const sysPrompt = activePreset === 'custom' ? customPromptText : PERSONALITY_PRESETS[activePreset].prompt;
          messages.push({ role: 'system', content: sysPrompt });
          saveSession();
          console.clear();
          console.log(getAsciiArt(currentModel));
          console.log(`${C_GREEN}Bandit:${C_RESET} Current session's trash log completely emptied!\n`);
          askQuestion();
          return;
        }

        if (command === '/new') {
          startNewSession();
          console.log(`\n${C_GREEN}Bandit:${C_RESET} Saved current session and initialized a new one! 🦝✨\n`);
          askQuestion();
          return;
        }

        if (command === '/sessions') {
          listSessions();
          askQuestion();
          return;
        }

        if (command === '/load') {
          if (!arg) {
            console.log(`\n${C_RED}Usage: /load <number_or_id>${C_RESET}\n`);
            askQuestion();
            return;
          }
          
          ensureSessionsDir();
          const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
          const sessions = [];
          for (const file of files) {
            try {
              const filePath = path.join(SESSIONS_DIR, file);
              const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              sessions.push(data);
            } catch (e) {}
          }
          sessions.sort((a, b) => b.createdAt - a.createdAt);

          let targetId = '';
          const index = parseInt(arg, 10);
          if (!isNaN(index) && index >= 1 && index <= sessions.length) {
            targetId = sessions[index - 1].id;
          } else {
            const found = sessions.find(s => s.id === arg || s.id.includes(arg));
            if (found) {
              targetId = found.id;
            }
          }

          if (targetId) {
            const ok = loadSession(targetId);
            if (ok) {
              console.clear();
              console.log(getAsciiArt(currentModel));
              console.log(`${C_GREEN}Bandit:${C_RESET} Loaded session: ${C_YELLOW}${currentSessionId}${C_RESET}`);
              console.log(`History contains ${C_YELLOW}${messages.filter(m => m.role !== 'system').length}${C_RESET} messages.\n`);
              
              const listMsgs = messages.filter(m => m.role !== 'system');
              if (listMsgs.length > 0) {
                console.log(`${C_GRAY}--- Last messages from history ---${C_RESET}`);
                listMsgs.slice(-5).forEach(m => {
                  const prefix = m.role === 'user' ? `${C_MAGENTA}${C_BRIGHT}You:${C_RESET}` : `${C_GREEN}${C_BRIGHT}Bandit:${C_RESET}`;
                  console.log(`${prefix} ${m.role === 'assistant' ? colorizeMarkdown(m.content) : m.content}\n`);
                });
                console.log(`${C_GRAY}----------------------------------${C_RESET}\n`);
              }
            } else {
              console.log(`\n${C_RED}Failed to load session details.${C_RESET}\n`);
            }
          } else {
            console.log(`\n${C_RED}Session not found: ${arg}${C_RESET}\n`);
          }
          askQuestion();
          return;
        }

        if (command === '/persona') {
          if (!arg) {
            console.log(`\n${C_CYAN}Current Persona:${C_RESET} ${C_YELLOW}${activePreset}${C_RESET} (${PERSONALITY_PRESETS[activePreset]?.name})`);
            console.log(`${C_GRAY}Description:${C_RESET} ${PERSONALITY_PRESETS[activePreset]?.description}`);
            console.log(`\n${C_CYAN}Available Personas:${C_RESET}`);
            for (const [key, value] of Object.entries(PERSONALITY_PRESETS)) {
              console.log(" " + ` ${C_MAGENTA}${key}${C_RESET} - ${value.name} (${C_GRAY}${value.description}${C_RESET})`);
            }
            console.log(`\nUse ${C_MAGENTA}/persona <name>${C_RESET} to swap.\n`);
          } else {
            const target = arg.toLowerCase().trim();
            if (PERSONALITY_PRESETS[target]) {
              activePreset = target;
              console.log(`\n${C_GREEN}Bandit:${C_RESET} Persona swapped to ${C_YELLOW}${PERSONALITY_PRESETS[target].name}${C_RESET}!`);
              startNewSession();
              console.log(`${C_GREEN}Bandit:${C_RESET} Started new session with the new persona instructions.\n`);
            } else {
              console.log(`\n${C_RED}Unknown persona: ${target}. Type /persona for options.${C_RESET}\n`);
            }
          }
          askQuestion();
          return;
        }

        if (command === '/model') {
          if (!arg) {
            console.log(`\nActive model: ${C_YELLOW}${currentModel}${C_RESET}\n`);
          } else {
            currentModel = arg;
            saveSession();
            console.log(`\n${C_GREEN}Bandit:${C_RESET} Active LLM swapped to: ${C_YELLOW}${currentModel}${C_RESET}\n`);
          }
          askQuestion();
          return;
        }

        if (command === '/pull') {
          if (!arg) {
            console.log(`\n${C_RED}Usage: /pull <model_name>${C_RESET}\n`);
          } else {
            await pullModel(arg.trim());
          }
          askQuestion();
          return;
        }

        if (command === '/temp') {
          if (!arg) {
            console.log(`\nTemperature: ${C_YELLOW}${temperature}${C_RESET} (default: 0.7)\n`);
          } else {
            const val = parseFloat(arg);
            if (isNaN(val) || val < 0 || val > 2) {
              console.log(`\n${C_RED}Invalid temperature value. Must be a number between 0.0 and 2.0.${C_RESET}\n`);
            } else {
              temperature = val;
              saveSession();
              console.log(`\n${C_GREEN}Bandit:${C_RESET} Temperature set to ${C_YELLOW}${temperature}${C_RESET}\n`);
            }
          }
          askQuestion();
          return;
        }

        if (command === '/top_p') {
          if (!arg) {
            console.log(`\nTop_p: ${C_YELLOW}${topP}${C_RESET} (default: 0.9)\n`);
          } else {
            const val = parseFloat(arg);
            if (isNaN(val) || val < 0 || val > 1) {
              console.log(`\n${C_RED}Invalid top_p value. Must be a number between 0.0 and 1.0.${C_RESET}\n`);
            } else {
              topP = val;
              saveSession();
              console.log(`\n${C_GREEN}Bandit:${C_RESET} Top_p set to ${C_YELLOW}${topP}${C_RESET}\n`);
            }
          }
          askQuestion();
          return;
        }

        if (command === '/ctx') {
          if (!arg) {
            console.log(`\nContext Size (num_ctx): ${C_YELLOW}${numCtx}${C_RESET} tokens (default: 2048)\n`);
          } else {
            const val = parseInt(arg, 10);
            if (isNaN(val) || val < 256 || val > 131072) {
              console.log(`\n${C_RED}Invalid context size. Must be an integer between 256 and 131072.${C_RESET}\n`);
            } else {
              numCtx = val;
              saveSession();
              console.log(`\n${C_GREEN}Bandit:${C_RESET} Context size set to ${C_YELLOW}${numCtx}${C_RESET} tokens\n`);
            }
          }
          askQuestion();
          return;
        }

        if (command === '/help') {
          printHelp();
          askQuestion();
          return;
        }

        console.log(`\n${C_RED}Unknown command: ${command}. Type /help for assistance.${C_RESET}\n`);
        askQuestion();
        return;
      }

      await chatStream(trimmed);
      askQuestion();
    });
  } catch (err) {
    // Ignore readline errors
  }
}

startCLI();
