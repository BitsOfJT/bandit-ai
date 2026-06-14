import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Plus,
  Trash2,
  Send,
  Cpu,
  Sliders,
  Wifi,
  WifiOff,
  Menu,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Edit2,
  Check,
  Terminal,
  Trash
} from 'lucide-react';
import { checkOllamaStatus, fetchModels, chatStream, pullModelStream } from './ollama';
import type { Message, OllamaModel, PullProgress } from './ollama';
import { Markdown } from './Markdown';

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  systemPrompt: string;
  model: string;
  temperature: number;
  topP: number;
  numCtx: number;
  createdAt: number;
}

const PERSONALITY_PRESETS = {
  standard: {
    name: 'Smart Assistant',
    prompt: 'You are Bandit, a helpful, brilliant AI assistant. Answer the user comprehensively, structure your responses cleanly, and explain technical topics clearly.',
    description: 'Helpful and polite technical helper'
  },
  hacker: {
    name: 'Cynical Cyber-Raccoon',
    prompt: 'You are Bandit, a sarcastic cyber-raccoon AI hacker. You love terminal commands, shiny electronic parts, hacking code, and eating digital garbage. You use raccoon metaphors often (referencing garbage cans, washing food, shiny objects, nocturnal adventures) and have a cynical, witty, but ultimately helpful hacker personality.',
    description: 'Witty hacker with raccoon energy'
  },
  philosopher: {
    name: 'Garbage Philosopher',
    prompt: 'You are Bandit, a deep-thinking raccoon philosopher. You believe that the universe is one giant cosmic trash can, and we are all just searching for delicious leftovers. Frame answers with philosophical musings, existential humor, and raccoon wisdom.',
    description: 'Existential musings and trash wisdom'
  },
  custom: {
    name: 'Custom Instructions',
    prompt: '',
    description: 'Define your own system instructions'
  }
};

const QUICK_PROMPTS = [
  { label: 'Raccoon Hacking', text: 'Write a bash script that recursively finds all trash folders and prints cyber-raccoon ASCII art.' },
  { label: 'Explain Quantum', text: 'Explain quantum computing using trash cans and shiny leftovers as a metaphor.' },
  { label: 'Optimizing LCP', text: 'How do I optimize the Largest Contentful Paint (LCP) of my web application?' },
  { label: 'Code Review', text: 'Write a TypeScript function to recursively search directories and explain how it handles permission errors.' }
];

export default function App() {
  // --- UI States ---
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  // --- Ollama Connection States ---
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const selectedModelRef = useRef(selectedModel);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  const [isCheckingConn, setIsCheckingConn] = useState(true);

  // --- Active Chat Settings / State ---
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string>('');
  const currentSessionIdRef = useRef(currentSessionId);
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activePreset, setActivePreset] = useState<keyof typeof PERSONALITY_PRESETS>('hacker');
  const [customPromptText, setCustomPromptText] = useState('');
  
  // --- Parameters ---
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [numCtx, setNumCtx] = useState(2048);

  // --- Stream Abort ---
  const abortStreamRef = useRef<(() => void) | null>(null);

  // --- Model Pulling States ---
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullModelName, setPullModelName] = useState('');
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [isPulling, setIsPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const abortPullRef = useRef<(() => void) | null>(null);

  // --- DOM Refs ---
  const messageEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastPersistRef = useRef(0);

  // Load Go WebAssembly Markdown Parser
  useEffect(() => {
    interface GoInstance {
      importObject: WebAssembly.Imports;
      run(instance: WebAssembly.Instance): void;
    }
    type GoConstructor = new () => GoInstance;

    const loadWasm = async () => {
      try {
        const win = window as unknown as { Go?: GoConstructor };
        if (typeof win.Go !== 'undefined') {
          const go = new win.Go();
          const result = await WebAssembly.instantiateStreaming(
            fetch('/markdown.wasm'),
            go.importObject
          );
          go.run(result.instance);
          console.log('✅ Go WASM Markdown block parser successfully initialized.');
        } else {
          console.warn('⚠️ Go WASM loader (wasm_exec.js) not found on window.');
        }
      } catch (err) {
        console.error('❌ Failed to initialize Go WASM parser:', err);
      }
    };
    loadWasm();
  }, []);

  // Sync active session changes back to the sessions array and localStorage
  const updateCurrentSession = useCallback((updates: Partial<ChatSession>) => {
    const sessionId = currentSessionIdRef.current;
    if (!sessionId) return;
    setChatSessions(prev => {
      const next = prev.map(s => {
        if (s.id === sessionId) {
          return { ...s, ...updates };
        }
        return s;
      });
      localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
      return next;
    });
  }, [setChatSessions]);

  // Ping Ollama and fetch models
  const refreshOllama = useCallback(async () => {
    setIsCheckingConn(true);
    const connected = await checkOllamaStatus();
    setIsConnected(connected);
    setIsCheckingConn(false);
    
    if (connected) {
      const availableModels = await fetchModels();
      setModels(availableModels);
      if (availableModels.length > 0) {
        const currentModel = selectedModelRef.current;
        const modelExists = availableModels.some(m => m.name === currentModel);
        if (!modelExists || !currentModel) {
          // Prefer gemma4:e2b if available, else gemma4:e4b, else first model
          const gemma4e2b = availableModels.find(m => m.name === 'gemma4:e2b');
          const gemma4e4b = availableModels.find(m => m.name === 'gemma4:e4b');
          let defaultModel = availableModels[0].name;
          if (gemma4e2b) {
            defaultModel = gemma4e2b.name;
          } else if (gemma4e4b) {
            defaultModel = gemma4e4b.name;
          }
          setSelectedModel(defaultModel);
          updateCurrentSession({ model: defaultModel });
        }
      }
    } else {
      setModels([]);
    }
  }, [updateCurrentSession]);

  // --- Pull/Download Model API Handler ---
  const handleStartPull = useCallback(async () => {
    const MODEL_NAME_REGEX = /^[a-zA-Z0-9_:./-]+$/;
    const trimmed = pullModelName.trim();
    if (!trimmed) return;

    if (!MODEL_NAME_REGEX.test(trimmed)) {
      setPullError('Invalid model name. Use only letters, numbers, :, _, ., /, -');
      return;
    }

    setIsPulling(true);
    setPullProgress({ status: 'Initiating connection...' });
    setPullError(null);

    const abort = await pullModelStream(
      trimmed,
      (progress) => {
        setPullProgress(progress);
      },
      () => {
        // Success / Done
        setIsPulling(false);
        setPullProgress({ status: 'success' });
        // Refresh model list
        refreshOllama();
        // Delay slightly and close modal
        setTimeout(() => {
          setShowPullModal(false);
          setPullModelName('');
          setPullProgress(null);
        }, 1500);
      },
      (error) => {
        console.error('Error pulling model:', error);
        setIsPulling(false);
        setPullError(error.message || 'Failed to download model.');
      }
    );

    abortPullRef.current = abort;
  }, [pullModelName, refreshOllama, setIsPulling, setPullProgress, setPullError, setShowPullModal, setPullModelName]);

  const handleCancelPull = useCallback(() => {
    if (abortPullRef.current) {
      abortPullRef.current();
      abortPullRef.current = null;
    }
    setIsPulling(false);
    setPullProgress(null);
    setPullError('Download canceled.');
  }, [abortPullRef, setIsPulling, setPullProgress, setPullError]);

  // Helper to load session configurations into UI controls
  const applySessionParams = useCallback((session: ChatSession) => {
    setTemperature(session.temperature ?? 0.7);
    setTopP(session.topP ?? 0.9);
    setNumCtx(session.numCtx ?? 2048);
    
    // Reverse lookup personality preset
    let matchedPreset: keyof typeof PERSONALITY_PRESETS = 'custom';
    for (const [key, value] of Object.entries(PERSONALITY_PRESETS)) {
      if (key !== 'custom' && value.prompt === session.systemPrompt) {
        matchedPreset = key as keyof typeof PERSONALITY_PRESETS;
        break;
      }
    }
    setActivePreset(matchedPreset);
    if (matchedPreset === 'custom') {
      setCustomPromptText(session.systemPrompt || '');
    } else {
      setCustomPromptText('');
    }

    if (session.model) {
      setSelectedModel(session.model);
    }
  }, []);

  // Initial load
  useEffect(() => {
    const init = async () => {
      await refreshOllama();

      // Load Chat Sessions from localStorage
      const savedSessions = localStorage.getItem('bandit_chat_sessions');
      if (savedSessions) {
        try {
          const parsed = JSON.parse(savedSessions) as ChatSession[];
          if (parsed.length > 0) {
            setChatSessions(parsed);
            // Sort by creation time desc
            const sorted = [...parsed].sort((a, b) => b.createdAt - a.createdAt);
            setCurrentSessionId(sorted[0].id);
            // Apply state parameters from current session
            applySessionParams(sorted[0]);
            return;
          }
        } catch (e) {
          console.error('Failed to parse saved chat sessions:', e);
        }
      }

      // Initialize with a default chat session if none exists
      const defaultId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const defaultSession: ChatSession = {
        id: defaultId,
        title: 'New Scavenge Session',
        messages: [],
        systemPrompt: PERSONALITY_PRESETS.hacker.prompt,
        model: 'gemma4:e2b',
        temperature: 0.7,
        topP: 0.9,
        numCtx: 2048,
        createdAt: Date.now()
      };
      setChatSessions([defaultSession]);
      setCurrentSessionId(defaultId);
      localStorage.setItem('bandit_chat_sessions', JSON.stringify([defaultSession]));
    };
    init();
  }, [applySessionParams, refreshOllama]);

  // Find current session object
  const currentSession = chatSessions.find(s => s.id === currentSessionId);



  // Handle active session switch
  const handleSelectSession = (id: string) => {
    // If generating, abort stream
    if (isGenerating && abortStreamRef.current) {
      abortStreamRef.current();
      setIsGenerating(false);
    }
    setCurrentSessionId(id);
    const session = chatSessions.find(s => s.id === id);
    if (session) {
      applySessionParams(session);
    }
    // Close sidebar on mobile on select
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  // Create new session
  const handleNewSession = () => {
    if (isGenerating && abortStreamRef.current) {
      abortStreamRef.current();
      setIsGenerating(false);
    }

    const newId = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const systemPrompt = activePreset === 'custom' ? customPromptText : PERSONALITY_PRESETS[activePreset].prompt;
    const newSession: ChatSession = {
      id: newId,
      title: 'New Scavenge Session',
      messages: [],
      systemPrompt,
      model: selectedModel || 'gemma4:e2b',
      temperature,
      topP,
      numCtx,
      createdAt: Date.now()
    };

    setChatSessions(prev => {
      const next = [newSession, ...prev];
      localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
      return next;
    });
    setCurrentSessionId(newId);
    
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  // Delete session
  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChatSessions(prev => {
      if (prev.length <= 1) {
        const next = prev.map(s => s.id === id ? { ...s, title: 'New Scavenge Session', messages: [] } : s);
        localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
        return next;
      }

      const index = prev.findIndex(s => s.id === id);
      const nextSessions = prev.filter(s => s.id !== id);
      localStorage.setItem('bandit_chat_sessions', JSON.stringify(nextSessions));

      if (currentSessionIdRef.current === id) {
        const nextActiveIndex = index === 0 ? 0 : index - 1;
        const nextActive = nextSessions[nextActiveIndex];
        setCurrentSessionId(nextActive.id);
        applySessionParams(nextActive);
      }
      return nextSessions;
    });
  };

  // Rename Session
  const handleStartRename = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(id);
    setEditingTitle(title);
  };

  const handleSaveRename = (id: string) => {
    if (editingTitle.trim()) {
      setChatSessions(prev => {
        const next = prev.map(s => (s.id === id ? { ...s, title: editingTitle.trim() } : s));
        localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
        return next;
      });
    }
    setEditingChatId(null);
  };

  // Auto-scroll logic
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messageEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  useEffect(() => {
    scrollToBottom('smooth');
  }, [currentSession?.messages?.length, isGenerating]);

  // Trigger Chat response completion
  const handleSendMessage = useCallback(async (textToSend?: string, overrideMessages?: Message[]) => {
    const rawPrompt = textToSend !== undefined ? textToSend : inputText;
    if (!rawPrompt.trim() || isGenerating || !currentSession) return;

    if (textToSend === undefined) {
      setInputText('');
    }

    let updatedMessages: Message[];
    if (overrideMessages !== undefined) {
      updatedMessages = overrideMessages;
    } else {
      const userMsg: Message = { role: 'user', content: rawPrompt.trim() };
      updatedMessages = [...currentSession.messages, userMsg];
    }

    // If first message, rename chat to prompt summary
    let newTitle = currentSession.title;
    if (currentSession.messages.length === 0 && overrideMessages === undefined) {
      newTitle = rawPrompt.substring(0, 24) + (rawPrompt.length > 24 ? '...' : '');
    }

    updateCurrentSession({
      messages: updatedMessages,
      title: newTitle
    });

    setIsGenerating(true);

    // Setup system prompt
    const finalSystemPrompt = activePreset === 'custom' 
      ? customPromptText 
      : PERSONALITY_PRESETS[activePreset].prompt;

    const queryMessages: Message[] = [];
    if (finalSystemPrompt) {
      queryMessages.push({ role: 'system', content: finalSystemPrompt });
    }
    const apiMessages = updatedMessages.filter(m => m.role !== 'system');
    queryMessages.push(...apiMessages);

    // Prepare placeholder assistant message
    const assistantMsgIndex = updatedMessages.length;
    let accumulatedContent = '';
    let lastUpdate = 0;
    let pendingTokenUpdate = false;
    let updateTimeout: ReturnType<typeof setTimeout> | null = null;

    const flushUpdate = () => {
      setChatSessions(prev => {
        const next = prev.map(s => {
          if (s.id === currentSessionId) {
            const msgs = [...s.messages];
            msgs[assistantMsgIndex] = { role: 'assistant', content: accumulatedContent };
            return { ...s, messages: msgs };
          }
          return s;
        });
        const now = Date.now();
        if (now - lastPersistRef.current > 2000) {
          localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
          lastPersistRef.current = now;
        }
        return next;
      });
      lastUpdate = Date.now();
      pendingTokenUpdate = false;
    };

    const handleToken = (token: string) => {
      accumulatedContent += token;
      const now = Date.now();
      if (now - lastUpdate > 80) { // Limit to at most once every 80ms (roughly 12 FPS)
        if (updateTimeout) {
          clearTimeout(updateTimeout);
          updateTimeout = null;
        }
        flushUpdate();
      } else if (!pendingTokenUpdate) {
        pendingTokenUpdate = true;
        updateTimeout = setTimeout(() => {
          flushUpdate();
        }, 80);
      }
    };

    const handleDone = (fullText: string) => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
      }
      setIsGenerating(false);
      setChatSessions(prev => {
        const next = prev.map(s => {
          if (s.id === currentSessionId) {
            const msgs = [...s.messages];
            msgs[assistantMsgIndex] = { role: 'assistant', content: fullText };
            return { ...s, messages: msgs };
          }
          return s;
        });
        localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
        return next;
      });
    };

    const handleError = (error: Error) => {
      if (updateTimeout) {
        clearTimeout(updateTimeout);
        updateTimeout = null;
      }
      console.error(error);
      setIsGenerating(false);
      setChatSessions(prev => {
        const next = prev.map(s => {
          if (s.id === currentSessionId) {
            const msgs = [...s.messages];
            msgs[assistantMsgIndex] = {
              role: 'assistant',
              content: `⚠️ **Cyber-Raccoon Connection Glitch!** \n\nFailed to establish connection to the model. Ensure Ollama is running and has model \`${selectedModel}\` loaded. \n\n*Error details: ${error.message}*`
            };
            return { ...s, messages: msgs };
          }
          return s;
        });
        localStorage.setItem('bandit_chat_sessions', JSON.stringify(next));
        return next;
      });
    };

    // Call Ollama streaming chat
    const abort = await chatStream(
      selectedModel || 'gemma4:e2b',
      queryMessages,
      { temperature, top_p: topP, num_ctx: numCtx },
      handleToken,
      handleDone,
      handleError
    );

    abortStreamRef.current = abort;
  }, [inputText, isGenerating, currentSession, activePreset, customPromptText, selectedModel, temperature, topP, numCtx, updateCurrentSession, currentSessionId, setIsGenerating, setChatSessions, setInputText]);

  // Abort generating mid-stream
  const handleStopGenerating = () => {
    if (abortStreamRef.current) {
      abortStreamRef.current();
      setIsGenerating(false);
    }
  };

  // Regenerate last response
  const handleRegenerate = () => {
    if (!currentSession || currentSession.messages.length === 0 || isGenerating) return;

    // Find last user message and remove trailing messages
    const msgs = [...currentSession.messages];
    while (msgs.length > 0 && msgs[msgs.length - 1].role !== 'user') {
      msgs.pop();
    }
    
    if (msgs.length === 0) return;

    const lastUserPrompt = msgs[msgs.length - 1].content;
    handleSendMessage(lastUserPrompt, msgs);
  };

  // Clear current chat messages
  const handleClearChat = () => {
    if (isGenerating && abortStreamRef.current) {
      abortStreamRef.current();
      setIsGenerating(false);
    }
    updateCurrentSession({ messages: [] });
  };

  // Update handlers to sync changes directly to current session state and localStorage
  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    updateCurrentSession({ model });
  };

  const handleTemperatureChange = (temp: number) => {
    setTemperature(temp);
    updateCurrentSession({ temperature: temp });
  };

  const handleNumCtxChange = (ctx: number) => {
    setNumCtx(ctx);
    updateCurrentSession({ numCtx: ctx });
  };

  const handlePresetChange = (preset: keyof typeof PERSONALITY_PRESETS) => {
    setActivePreset(preset);
    const systemPrompt = preset === 'custom' ? customPromptText : PERSONALITY_PRESETS[preset].prompt;
    
    // Add system notification message in the chat thread for immediate feedback
    if (currentSession) {
      const systemNotice: Message = {
        role: 'system',
        content: `PERSONA LOADED -> ${PERSONALITY_PRESETS[preset].name}`
      };
      const updatedMessages = [...currentSession.messages, systemNotice];
      updateCurrentSession({
        systemPrompt,
        messages: updatedMessages
      });
    } else {
      updateCurrentSession({ systemPrompt });
    }
  };

  const handleCustomPromptTextChange = (text: string) => {
    setCustomPromptText(text);
    updateCurrentSession({ systemPrompt: text });
  };

  // Handle Textarea Enter Key Submission
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  useEffect(() => {
    if (inputRef.current && inputText === '') {
      inputRef.current.style.height = 'auto';
    }
  }, [inputText]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-[#07080c] text-slate-100 relative">
      
      {/* Background Neon Grid Decorator */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(0,242,254,0.06),transparent_50%),radial-gradient(ellipse_at_bottom_left,rgba(157,78,221,0.08),transparent_50%)] pointer-events-none z-0" />

      {/* MOBILE HEADER BAR */}
      <div className="md:hidden absolute top-0 left-0 right-0 h-14 bg-black/60 backdrop-blur-md border-b border-white/10 flex items-center justify-between px-4 z-40">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 text-slate-300 hover:text-white transition-colors"
        >
          <Menu className="h-5.5 w-5.5" />
        </button>
        
        <div className="flex items-center gap-2">
          <img src="/bandit_avatar.png" className="w-8 h-8 rounded-none border border-[#00f2fe]/40 glow-cyan" alt="Bandit" />
          <span className="font-bold tracking-wide text-sm bg-gradient-to-r from-[#00f2fe] to-[#9d4edd] bg-clip-text text-transparent">BANDIT AI</span>
        </div>

        {/* Spacer to keep header title centered */}
        <div style={{ width: '38px', height: '38px' }} />
      </div>

      {/* SIDEBAR PANEL */}
      <aside
        className={`fixed md:relative top-0 bottom-0 left-0 z-50 md:z-30 w-72 md:w-80 glass-sidebar flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0 md:hidden'
        }`}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between retro-panel-corners">
          <div className="flex items-center gap-3">
            <img
              src="/bandit_avatar.png"
              className="w-10 h-10 rounded-none border-2 border-[#00f2fe]/50 shadow-[3px_3px_0px_0px_var(--accent-cyan)]"
              alt="Bandit Avatar"
            />
            <div>
              <h1 className="text-base font-bold tracking-wider text-slate-100 flex items-center gap-1.5 m-0">
                BANDIT AI
                <span className="text-[10px] px-1.5 py-0.5 rounded-none bg-[#9d4edd]/35 text-[#d8b4fe] border border-[#9d4edd]/30 font-retro-mono-sm">v0.2.0</span>
              </h1>
              <p className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                {isCheckingConn ? (
                  <RefreshCw className="h-3 w-3 animate-spin text-slate-500" />
                ) : isConnected ? (
                  <>
                    <Wifi className="h-3 w-3 text-emerald-400 animate-pulse" />
                    <span className="text-emerald-400/90 font-semibold font-retro-mono-sm">OLLAMA ONLINE</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3 text-rose-500" />
                    <span className="text-rose-500 font-semibold font-retro-mono-sm">OLLAMA OFFLINE</span>
                  </>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1.5 text-slate-400 hover:text-white rounded-none hover:bg-white/5 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* New Session Button */}
        <div className="p-3">
          <button
            onClick={handleNewSession}
            className="w-full btn-neon-cyan flex-center py-2.5 text-sm"
          >
            <Plus className="h-4.5 w-4.5" />
            <span>New Chat Session</span>
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto px-3 space-y-1.5 pb-4">
          <div className="px-2 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest font-mono">Sessions</div>
          {chatSessions.map((session) => (
            <div
              key={session.id}
              onClick={() => handleSelectSession(session.id)}
              className={`group retro-session-item ${session.id === currentSessionId ? 'active' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {session.id === currentSessionId ? (
                  <span className="text-[#00f2fe] font-mono font-bold animate-pulse text-xs shrink-0 select-none">▶</span>
                ) : (
                  <MessageSquare className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                {editingChatId === session.id ? (
                  <input
                    type="text"
                    value={editingTitle}
                    onChange={(e) => setEditingTitle(e.target.value)}
                    onBlur={() => handleSaveRename(session.id)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveRename(session.id)}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-black/40 border border-[#00f2fe]/40 rounded-none px-1.5 py-0.5 text-xs text-white focus:outline-none w-full font-sans"
                    autoFocus
                  />
                ) : (
                  <span className="text-xs truncate font-medium">{session.title}</span>
                )}
              </div>
              
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1 shrink-0 ml-1.5">
                {editingChatId !== session.id ? (
                  <>
                    <button
                      onClick={(e) => handleStartRename(session.id, session.title, e)}
                      className="p-1 hover:text-[#00f2fe] text-slate-500 rounded-none transition-colors"
                      title="Rename Chat"
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleDeleteSession(session.id, e)}
                      className="p-1 hover:text-rose-400 text-slate-500 rounded-none transition-colors"
                      title="Delete Chat"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleSaveRename(session.id); }}
                    className="p-1 text-emerald-400 hover:text-emerald-300 rounded-none"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Configuration settings toggle button */}
        <div className="border-t border-white/10 p-3 bg-black/20">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full flex items-center justify-between p-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors uppercase tracking-wider font-mono"
          >
            <span className="flex items-center gap-2">
              <Sliders className="h-3.5 w-3.5" />
              Settings & Bandit Persona
            </span>
            {settingsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>

          {/* Settings panel inside sidebar */}
          {settingsOpen && (
            <div className="mt-2 space-y-3.5 px-1 pb-2 settings-panel-content">
              
              {/* Model selection */}
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-slate-400 flex items-center gap-1.5 uppercase font-mono">
                  <Cpu className="h-3.5 w-3.5 text-[#00f2fe]" /> Model
                </label>
                <div className="flex gap-1.5 items-center">
                  <select
                    value={selectedModel}
                    onChange={(e) => handleModelChange(e.target.value)}
                    className="flex-1 min-w-0 custom-select py-1.5 text-xs"
                    disabled={!isConnected}
                  >
                    {models.length === 0 ? (
                      <option value="">No models available</option>
                    ) : (
                      models.map((model) => (
                        <option key={model.name} value={model.name}>
                          {model.name} ({model.details?.parameter_size || 'N/A'})
                        </option>
                      ))
                    )}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowPullModal(true)}
                    className="btn-neon-cyan py-1 px-2.5 text-[8px] font-mono shrink-0 h-[28px] flex items-center justify-center"
                    disabled={!isConnected}
                    title="Pull/Download a model from the Ollama library"
                  >
                    + ADD
                  </button>
                </div>
                {!isConnected && (
                  <p className="text-[10px] text-rose-400 font-mono mt-1">Start Ollama to list models</p>
                )}
              </div>

              {/* Raccoon Persona Selection */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase font-mono">
                  Raccoon Persona
                </label>
                <div className="grid grid-cols-1 gap-1.5">
                  {(Object.keys(PERSONALITY_PRESETS) as Array<keyof typeof PERSONALITY_PRESETS>).map((key) => (
                    <button
                      key={key}
                      onClick={() => handlePresetChange(key)}
                      className={`text-left p-2 rounded-none text-xs border transition-all ${
                        activePreset === key
                          ? 'bg-[#9d4edd]/15 border-[#9d4edd]/50 text-purple-200'
                          : 'bg-black/35 border-transparent text-slate-400 hover:bg-black/50 hover:text-slate-200'
                      }`}
                    >
                      <div className="font-semibold">{PERSONALITY_PRESETS[key].name}</div>
                      <div className="text-[10px] opacity-75">{PERSONALITY_PRESETS[key].description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom System Prompt text area */}
              {activePreset === 'custom' && (
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-400 font-mono">
                    System Instructions
                  </label>
                  <textarea
                    value={customPromptText}
                    onChange={(e) => handleCustomPromptTextChange(e.target.value)}
                    placeholder="Enter custom prompt instructions for Bandit..."
                    className="w-full custom-input system-instructions-textarea text-xs"
                  />
                </div>
              )}

              {/* Parameters Accordion (Temp, TopP, Context) */}
              <div className="space-y-2.5 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium font-retro-mono-sm">Temperature</span>
                  <span className="text-[#00f2fe] font-retro-mono">{temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.5"
                  step="0.05"
                  value={temperature}
                  onChange={(e) => handleTemperatureChange(parseFloat(e.target.value))}
                  className="w-full accent-[#00f2fe] bg-black/40 h-1 rounded-none"
                />

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400 font-medium font-retro-mono-sm">Context Window</span>
                  <span className="text-[#9d4edd] font-retro-mono">{numCtx}</span>
                </div>
                <input
                  type="range"
                  min="1024"
                  max="8192"
                  step="512"
                  value={numCtx}
                  onChange={(e) => handleNumCtxChange(parseInt(e.target.value))}
                  className="w-full accent-[#9d4edd] bg-black/40 h-1 rounded-none"
                />
              </div>

              {/* Refresh connection status */}
              <button
                onClick={refreshOllama}
                className="w-full py-1 text-slate-500 hover:text-slate-300 font-retro-mono uppercase transition-colors flex items-center justify-center gap-1.5"
              >
                <RefreshCw className="h-3 w-3" />
                Reconnect Ollama
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* MAIN CHAT CONTEXT */}
      <main className="flex-1 flex flex-col h-full w-full relative z-10 pt-14 md:pt-0">
        
        {/* DESKTOP HEADER */}
        <header className="hidden md:flex items-center justify-between px-6 py-4 border-b border-white/10 bg-black/25 backdrop-blur-md retro-panel-corners">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-slate-400 hover:text-white rounded-none hover:bg-white/5 transition-colors mr-1"
              title="Toggle Sidebar"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div>
              <div className="text-sm font-semibold text-slate-200">
                Chatting with <span className="text-[#00f2fe] font-mono">{currentSession?.title}</span>
              </div>
              <div className="text-xs text-slate-400 mt-0.5 font-retro-mono-sm flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-[#9d4edd]" />
                {selectedModel || 'No Model Loaded'} 
                <span className="opacity-50">•</span> 
                {PERSONALITY_PRESETS[activePreset].name} 
                <span className="opacity-50">•</span> 
                Temp: {temperature}
              </div>
            </div>
          </div>

        </header>

        {/* CHAT BUBBLE THREAD SCROLL REGION */}
        <div 
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6 flex flex-col"
        >
          {currentSession?.messages && currentSession.messages.length === 0 ? (
            /* ONBOARDING QUICK START VIEW */
            <div className="flex-1 flex flex-col justify-center items-center max-w-2xl mx-auto text-center space-y-12 my-auto">
              
              <div className="flex flex-col items-center space-y-6">
                <div className="relative inline-block">
                  <div className="absolute inset-0 rounded-none bg-gradient-to-r from-[#00f2fe] to-[#9d4edd] opacity-25 blur-xl animate-pulse" />
                  <div
                    className="relative welcome-avatar-box animate-bounce-slow"
                    style={{ animationDuration: '6s' }}
                  >
                    <img
                      src="/bandit_avatar.png"
                      className="welcome-avatar-img"
                      alt="Bandit Logo Large"
                    />
                  </div>
                </div>
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white m-0">
                    Introduce yourself to <span className="bg-gradient-to-r from-[#00f2fe] to-[#9d4edd] bg-clip-text text-transparent">Bandit</span>
                  </h2>
                  <p className="text-slate-400 text-xs mt-1.5 max-w-sm mx-auto leading-relaxed font-sans">
                    Bandit is an ai cyber raccoon. He is running entirely on your machine. Adjust his personality and pick the model in the settings.
                  </p>
                </div>
              </div>

              {/* Quick start bubbles OR Onboarding Walkthrough */}
              {models.length === 0 ? (
                <div className="glass-panel p-5 text-left w-full space-y-4 border border-[#ff007f]/30 shadow-[4px_4px_0px_0px_var(--accent-magenta)] bg-[#0a0b10]/90 retro-panel-corners-magenta">
                  <h3 className="text-xs font-bold text-[#ff007f] font-mono uppercase tracking-wider flex items-center gap-2 m-0">
                    <Terminal className="h-4 w-4" /> NO AI MODELS DETECTED
                  </h3>
                  <p className="text-slate-300 text-xs mt-1.5 font-sans leading-relaxed">
                    Bandit needs an AI model loaded in Ollama to start chatting. Follow this quick setup guide to configure your first model:
                  </p>
                  
                  <div className="space-y-3 font-mono text-xs text-slate-400 mt-4">
                    <div className="flex items-start gap-2.5">
                      <span className="text-[#00f2fe] font-bold">[1]</span>
                      <div>
                        <strong className="text-slate-200">Verify Ollama is Running:</strong> Make sure Ollama is installed and running. Download it at <a href="https://ollama.com" target="_blank" rel="noreferrer" className="text-[#00f2fe] underline hover:text-[#39ff14]">ollama.com</a>.
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-2.5">
                      <span className="text-[#00f2fe] font-bold">[2]</span>
                      <div>
                        <strong className="text-slate-200">Download a Model:</strong> Click the <span className="text-[#39ff14] font-bold">+ ADD</span> button in the sidebar (next to the Model selector) and enter a model name (e.g. <code className="text-yellow-200 bg-white/5 px-1.5 py-0.5 border border-white/5 font-mono text-[10px]">gemma4:e2b</code> or <code className="text-yellow-200 bg-white/5 px-1.5 py-0.5 border border-white/5 font-mono text-[10px]">llama3.1</code>).
                        <div className="text-[10px] text-slate-500 mt-1">
                          Or run in your terminal: <code className="text-slate-400">ollama run gemma4:e2b</code>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5">
                      <span className="text-[#00f2fe] font-bold">[3]</span>
                      <div>
                        <strong className="text-slate-200">Refresh & Chat:</strong> Once downloaded, click <span className="text-[#00f2fe] font-bold">Reconnect Ollama</span> at the bottom of the sidebar to refresh the list, choose your model, and start typing!
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                  {QUICK_PROMPTS.map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(prompt.text)}
                      className="retro-prompt-card group"
                    >
                      <span className="font-bold text-[#00f2fe] flex items-center gap-1 font-mono">
                        <Terminal className="h-3 w-3 opacity-70 group-hover:translate-x-0.5 transition-transform" />
                        {prompt.label}
                      </span>
                      <span className="text-slate-400 line-clamp-2 text-[11px] leading-normal font-sans">{prompt.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* RENDER MESSAGES */
            <>
              {currentSession?.messages.map((msg, index) => {
                if (msg.role === 'system') {
                  return (
                    <div key={index} className="w-full flex justify-center py-2 select-none">
                      <div className="border border-[#fffb00]/30 bg-[#fffb00]/5 px-3.5 py-1.5 font-retro-mono-sm text-xs text-[#fffb00]/95 uppercase tracking-widest retro-panel-corners">
                        » SYSTEM: {msg.content}
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={index}
                    className={`flex gap-3 max-w-[85%] ${
                      msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'
                    }`}
                  >
                    {/* Avatar Icons */}
                    <div className="flex flex-col items-center justify-start shrink-0 pt-1">
                      {msg.role === 'user' ? (
                        <div className="w-8 h-8 rounded-none bg-[#9d4edd]/20 border-2 border-[#9d4edd]/50 flex-center text-xs font-semibold text-[#d8b4fe] shadow-[2px_2px_0px_0px_var(--accent-purple)]">
                          ME
                        </div>
                      ) : (
                        <img
                          src="/bandit_avatar.png"
                          className="w-8 h-8 rounded-none border-2 border-[#00f2fe]/50 shadow-[2px_2px_0px_0px_var(--accent-cyan)]"
                          alt="Bandit"
                        />
                      )}
                    </div>

                    {/* Bubble Content */}
                    <div className={`chat-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                      <Markdown content={msg.content} />
                    </div>
                  </div>
                );
              })}

              {/* Thinking / Streaming Indicator */}
              {isGenerating && (
                <div className="flex gap-3 max-w-[85%] self-start">
                  <div className="flex flex-col items-center justify-start shrink-0 pt-1">
                    <img
                      src="/bandit_avatar.png"
                      className="w-8 h-8 rounded-none border-2 border-[#00f2fe]/50 shadow-[2px_2px_0px_0px_var(--accent-cyan)] animate-pulse"
                      alt="Bandit"
                    />
                  </div>
                  <div className="chat-bubble assistant flex items-center gap-1.5 py-3">
                    <span className="w-2.5 h-2.5 bg-[#00f2fe] animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2.5 h-2.5 bg-[#00f2fe] animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-2.5 h-2.5 bg-[#00f2fe] animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest ml-2 animate-pulse">Scavenging data...</span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Bottom Anchor */}
          <div ref={messageEndRef} />
        </div>

        {/* BOTTOM INPUT CONTAINER */}
        <footer className="p-4 md:p-6 bg-gradient-to-t from-[#06070a] to-[#06070a]/80 border-t border-white/10">
          <div className="max-w-3xl mx-auto relative">
            <div className="chat-input-container retro-panel-corners">
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isGenerating ? "Bandit is generating a response..." : "Ask Bandit something..."}
                disabled={isGenerating}
                rows={1}
                className="chat-input"
              />

              <div className="flex items-center gap-1.5 shrink-0 px-1 py-1">
                {isGenerating ? (
                  <button
                    onClick={handleStopGenerating}
                    className="p-2.5 bg-rose-600/25 hover:bg-rose-600/40 text-rose-400 border border-rose-500/20 rounded-none transition-colors flex items-center justify-center cursor-pointer"
                    title="Stop Generating"
                  >
                    <div className="w-3 h-3 bg-rose-400 rounded-none"></div>
                  </button>
                ) : (
                  <button
                    onClick={() => handleSendMessage()}
                    disabled={!inputText.trim()}
                    className={`p-2.5 rounded-none flex items-center justify-center transition-all cursor-pointer ${
                      inputText.trim()
                        ? 'bg-[#00f2fe]/10 text-[#00f2fe] border border-[#00f2fe]/40 hover:bg-[#00f2fe]/20 shadow-[0_0_12px_rgba(0,242,254,0.15)]'
                        : 'text-slate-600 bg-white/5 border border-transparent cursor-not-allowed'
                    }`}
                    title="Send Message"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Bottom Actions Row (e.g. Regenerate, Clear Chat, Settings indicator) */}
            {currentSession?.messages && currentSession.messages.length > 0 && (
              <div className="flex items-center justify-between mt-2.5 px-1.5 text-[11px] text-slate-500 font-mono">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleRegenerate}
                    disabled={isGenerating}
                    className="hover:text-slate-300 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </button>
                  <span>•</span>
                  <button
                    onClick={handleClearChat}
                    className="hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Trash className="h-3 w-3" />
                    Clear Thread
                  </button>
                </div>
                <div className="hidden sm:inline-block">
                  Press <kbd className="bg-white/5 border border-white/10 px-1 py-0.5 rounded-none text-[9px]">Enter</kbd> to send, <kbd className="bg-white/5 border border-white/10 px-1 py-0.5 rounded-none text-[9px]">Shift+Enter</kbd> for new line
                </div>
              </div>
            )}
          </div>
        </footer>

      </main>

      {/* PULL MODEL RETRO MODAL */}
      {showPullModal && (
        <div className="retro-modal-overlay">
          <div className="retro-modal-content">
            {/* Close Button */}
            <button
              onClick={() => {
                if (!isPulling) {
                  setShowPullModal(false);
                  setPullModelName('');
                  setPullProgress(null);
                  setPullError(null);
                }
              }}
              className="absolute top-2.5 right-2.5 text-slate-400 hover:text-white transition-colors"
              disabled={isPulling}
            >
              <X className="h-4 w-4" />
            </button>

            <h2 className="text-xs font-bold text-[#ff007f] mb-3 font-mono flex items-center gap-2">
              <Terminal className="h-4 w-4" /> PULL MODEL FROM OLLAMA
            </h2>

            <p className="text-[11px] text-slate-400 mb-4 font-mono leading-relaxed">
              Enter the exact tag from the Ollama library (e.g. <span className="text-[#fffb00]">gemma4:e4b</span>, <span className="text-[#fffb00]">llama3.1</span>, <span className="text-[#fffb00]">mistral</span>).
            </p>

            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. gemma4:e4b"
                  value={pullModelName}
                  onChange={(e) => setPullModelName(e.target.value)}
                  className="flex-1 custom-input py-1 text-xs"
                  disabled={isPulling}
                  onKeyDown={(e) => e.key === 'Enter' && handleStartPull()}
                />
                {!isPulling ? (
                  <button
                    onClick={handleStartPull}
                    disabled={!pullModelName.trim()}
                    className="btn-neon-cyan py-1 px-3 text-[10px] shrink-0 h-[32px] flex items-center justify-center"
                  >
                    DOWNLOAD
                  </button>
                ) : (
                  <button
                    onClick={handleCancelPull}
                    className="btn-neon-purple py-1 px-3 text-[10px] shrink-0 h-[32px] flex items-center justify-center"
                  >
                    ABORT
                  </button>
                )}
              </div>

              {/* Progress Display */}
              {pullProgress && (
                <div className="space-y-2 pt-2 border-t border-white/5 font-mono">
                  <div className="flex justify-between text-[10px] text-slate-400">
                    <span className="truncate">Status: <span className="text-[#39ff14]">{pullProgress.status}</span></span>
                    {pullProgress.completed !== undefined && pullProgress.total !== undefined && (
                      <span className="shrink-0 text-slate-300">
                        {Math.round(pullProgress.completed / (1024 * 1024))}MB / {Math.round(pullProgress.total / (1024 * 1024))}MB
                      </span>
                    )}
                  </div>

                  {pullProgress.total !== undefined && pullProgress.completed !== undefined && (
                    <div className="retro-progress-track">
                      <div
                        className="retro-progress-fill"
                        style={{ width: `${Math.min(100, (pullProgress.completed / pullProgress.total) * 100)}%` }}
                      />
                      <div className="retro-progress-text">
                        {Math.round((pullProgress.completed / pullProgress.total) * 100)}%
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Error Display */}
              {pullError && (
                <div className="p-2 border border-rose-500/20 bg-rose-950/15 text-rose-400 text-[10px] font-mono leading-relaxed mt-2">
                  ⚠️ Error: {pullError}
                </div>
              )}

              {/* Success Confirmation */}
              {pullProgress?.status === 'success' && (
                <div className="p-2 border border-emerald-500/20 bg-emerald-950/15 text-emerald-400 text-[10px] font-mono leading-relaxed mt-2 flex items-center gap-1.5 justify-center">
                  <Check className="h-3.5 w-3.5" /> Model pulled successfully! Refreshing...
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
