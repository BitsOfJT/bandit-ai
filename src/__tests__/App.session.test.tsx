import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from '../App'

// Mock ollama module so tests don't need actual Ollama running
vi.mock('../ollama', () => ({
  checkOllamaStatus: vi.fn().mockResolvedValue(false),
  fetchModels: vi.fn().mockResolvedValue([]),
  chatStream: vi.fn(),
  pullModelStream: vi.fn(),
}))

const PERSONALITY_PRESETS = {
  standard: {
    name: 'Smart Assistant',
    prompt: 'You are Bandit, a helpful, brilliant AI assistant. Answer the user comprehensively, structure your responses cleanly, and explain technical topics clearly.',
    description: 'Helpful and polite technical helper',
  },
  hacker: {
    name: 'Cynical Cyber-Raccoon',
    prompt: 'You are Bandit, a sarcastic cyber-raccoon AI hacker. You love terminal commands, shiny electronic parts, hacking code, and eating digital garbage. You use raccoon metaphors often (referencing garbage cans, washing food, shiny objects, nocturnal adventures) and have a cynical, witty, but ultimately helpful hacker personality.',
    description: 'Witty hacker with raccoon energy',
  },
  philosopher: {
    name: 'Garbage Philosopher',
    prompt: 'You are Bandit, a deep-thinking raccoon philosopher. You believe that the universe is one giant cosmic trash can, and we are all just searching for delicious leftovers. Frame answers with philosophical musings, existential humor, and raccoon wisdom.',
    description: 'Existential musings and trash wisdom',
  },
  custom: {
    name: 'Custom Instructions',
    prompt: '',
    description: 'Define your own system instructions',
  },
}

const hackerPrompt = PERSONALITY_PRESETS.hacker.prompt
const philosopherPrompt = PERSONALITY_PRESETS.philosopher.prompt

function makeSession(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: 'New Scavenge Session',
    messages: [],
    systemPrompt: hackerPrompt,
    model: 'gemma4:e2b',
    temperature: 0.7,
    topP: 0.9,
    numCtx: 2048,
    createdAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  localStorage.clear()
})

describe('App session lifecycle', () => {
  it('creates default session on first load (no localStorage data)', async () => {
    render(<App />)

    // Wait for the init effect to finish — it sets a default session
    await vi.waitFor(() => {
      const stored = localStorage.getItem('bandit_chat_sessions')
      expect(stored).not.toBeNull()
    })

    const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].title).toBe('New Scavenge Session')
    expect(sessions[0].messages).toEqual([])
  })

  it('loads saved sessions from localStorage on mount', async () => {
    const saved = [makeSession('saved-1', { title: 'My Saved Chat' })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    // The saved session title should appear in the sidebar — use getAllByText since
    // it also appears in the header display span
    await vi.waitFor(() => {
      const matches = screen.getAllByText('My Saved Chat')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('handleNewSession creates a new session and switches to it', async () => {
    render(<App />)

    // Wait for default session to load
    await vi.waitFor(() => {
      expect(localStorage.getItem('bandit_chat_sessions')).not.toBeNull()
    })

    // Click "New Chat Session" button
    const newBtn = screen.getByText('New Chat Session')
    fireEvent.click(newBtn)

    // Now there should be 2 sessions
    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions).toHaveLength(2)
    })

    const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
    // The newest session should be first (new sessions are prepended)
    expect(sessions[0].messages).toEqual([])
  })

  it('handleDeleteSession on last session clears messages instead of deleting', async () => {
    const saved = [makeSession('only-one', { title: 'Only Session' })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      const matches = screen.getAllByText('Only Session')
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })

    // Find the delete button — it's inside the sidebar session div
    const deleteBtns = screen.getAllByTitle('Delete Chat')
    expect(deleteBtns.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(deleteBtns[0])

    // Since it's the only session, it should clear messages/reset title, not remove
    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].messages).toEqual([])
    })
  })

  it('handleDeleteSession deletes a non-active session', async () => {
    const saved = [
      makeSession('active-session', { title: 'Active Chat', createdAt: Date.now() }),
      makeSession('other-session', { title: 'Other Chat', createdAt: Date.now() - 1000 }),
    ]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      const activeMatch = screen.getAllByText('Active Chat')
      const otherMatch = screen.getAllByText('Other Chat')
      expect(activeMatch.length).toBeGreaterThanOrEqual(1)
      expect(otherMatch.length).toBeGreaterThanOrEqual(1)
    })

    // Find the sidebar session divs — there should be 2 session items
    // Each .retro-session-item contains a session title and action buttons
    const sessionItems = document.querySelectorAll('.retro-session-item')
    expect(sessionItems.length).toBe(2)

    // Find which one contains "Other Chat" (the non-active session)
    let otherItem: Element | null = null
    for (const item of sessionItems) {
      if (item.textContent?.includes('Other Chat')) {
        otherItem = item
        break
      }
    }
    expect(otherItem).not.toBeNull()

    const deleteBtn = otherItem!.querySelector('button[title="Delete Chat"]')
    expect(deleteBtn).not.toBeNull()
    fireEvent.click(deleteBtn!)

    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('active-session')
    })
  })

  it('handleDeleteSession deletes the active session and switches to next', async () => {
    const saved = [
      makeSession('session-1', { title: 'First Session', createdAt: Date.now() }),
      makeSession('session-2', { title: 'Second Session', createdAt: Date.now() - 1000 }),
    ]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      expect(screen.getAllByText('First Session').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Second Session').length).toBeGreaterThanOrEqual(1)
    })

    // Delete the active session (First Session, first in list)
    const sessionItems = document.querySelectorAll('.retro-session-item')
    let firstItem: Element | null = null
    for (const item of sessionItems) {
      if (item.textContent?.includes('First Session')) {
        firstItem = item
        break
      }
    }
    expect(firstItem).not.toBeNull()

    const deleteBtn = firstItem!.querySelector('button[title="Delete Chat"]')
    expect(deleteBtn).not.toBeNull()
    fireEvent.click(deleteBtn!)

    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('session-2')
    })
  })

  it('handleStartRename / handleSaveRename renames a session', async () => {
    const saved = [makeSession('rename-me', { title: 'Old Title' })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      expect(screen.getAllByText('Old Title').length).toBeGreaterThanOrEqual(1)
    })

    // Find the rename button inside the session item
    const renameBtns = screen.getAllByTitle('Rename Chat')
    expect(renameBtns.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(renameBtns[0])

    // Now an input should appear with the old title
    const input = document.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.value).toBe('Old Title')

    // Clear and type new title
    fireEvent.change(input, { target: { value: 'Renamed Session' } })

    // Trigger save via blur
    fireEvent.blur(input)

    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions[0].title).toBe('Renamed Session')
    })
  })

  it('handleSelectSession switches active session', async () => {
    const saved = [
      makeSession('first-session', { title: 'Session Alpha', createdAt: Date.now() }),
      makeSession('second-session', { title: 'Session Beta', createdAt: Date.now() - 1000 }),
    ]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      expect(screen.getAllByText('Session Alpha').length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText('Session Beta').length).toBeGreaterThanOrEqual(1)
    })

    // Click on Session Beta sidebar item to switch to it
    const sessionItems = document.querySelectorAll('.retro-session-item')
    let betaItem: Element | null = null
    for (const item of sessionItems) {
      if (item.textContent?.includes('Session Beta')) {
        betaItem = item
        break
      }
    }
    expect(betaItem).not.toBeNull()
    fireEvent.click(betaItem!)

    // The header should now show "Chatting with Session Beta"
    await vi.waitFor(() => {
      const headerEl = screen.getByText(/Chatting with/)
      expect(headerEl.textContent).toContain('Session Beta')
    })
  })

  it('handleClearChat clears messages from current session', async () => {
    const saved = [
      makeSession('clear-me', {
        title: 'Clear Chat',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      }),
    ]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    // Wait for the session list to render (with messages present)
    await vi.waitFor(() => {
      expect(screen.getAllByText('Clear Chat').length).toBeGreaterThanOrEqual(1)
    })

    // Find and click the "Clear Thread" button in the footer
    const clearBtn = screen.getByText('Clear Thread')
    expect(clearBtn).toBeInTheDocument()
    fireEvent.click(clearBtn)

    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions[0].messages).toEqual([])
    })
  })

  it('applySessionParams correctly reverse-looks up preset from systemPrompt', async () => {
    // Create a session with the philosopher system prompt
    const saved = [makeSession('phil-session', {
      title: 'Philosopher Chat',
      systemPrompt: philosopherPrompt,
      messages: [{ role: 'system', content: philosopherPrompt }],
    })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    // After loading, the philosopher persona name should appear in the settings panel
    await vi.waitFor(() => {
      const nameEls = screen.getAllByText('Garbage Philosopher')
      expect(nameEls.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('applySessionParams falls back to custom for unknown prompts', async () => {
    const customPrompt = 'This is a completely custom instruction set that no preset matches.'
    const saved = [makeSession('custom-session', {
      title: 'Custom Prompt Chat',
      systemPrompt: customPrompt,
      messages: [{ role: 'system', content: customPrompt }],
    })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    // The "Custom Instructions" persona button should be active
    await vi.waitFor(() => {
      const customBtns = screen.getAllByText('Custom Instructions')
      expect(customBtns.length).toBeGreaterThanOrEqual(1)
    })
  })

  it('session title auto-named from first message (first 24 chars)', async () => {
    const saved = [makeSession('auto-name', {
      title: 'New Scavenge Session',
      messages: [],
    })]
    localStorage.setItem('bandit_chat_sessions', JSON.stringify(saved))

    render(<App />)

    await vi.waitFor(() => {
      expect(screen.getAllByText('New Scavenge Session').length).toBeGreaterThanOrEqual(1)
    })

    // Type a long message into the textarea
    const textarea = document.querySelector('textarea')!
    expect(textarea).not.toBeNull()

    const longMessage = 'This is my very long first message to Bandit the raccoon!'
    fireEvent.change(textarea, { target: { value: longMessage } })

    // Click send button
    const sendBtn = document.querySelector('button[title="Send Message"]') as HTMLButtonElement
    expect(sendBtn).not.toBeNull()
    expect(sendBtn.disabled).toBe(false)
    fireEvent.click(sendBtn)

    // The title should be auto-named from the first message
    await vi.waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('bandit_chat_sessions')!)
      expect(sessions[0].title).toBe('This is my very long fir...')
    })
  })
})