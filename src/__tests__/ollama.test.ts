import { describe, it, expect, vi, beforeAll, afterEach, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { checkOllamaStatus, fetchModels, chatStream, pullModelStream, parseCloudCatalog, parseCloudTags } from '../ollama'
import type { PullProgress } from '../ollama'

// Helper to build an NDJSON ReadableStream from an array of JSON objects
function createNDJSONStream<T>(items: T[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const item of items) {
        controller.enqueue(encoder.encode(JSON.stringify(item) + '\n'))
      }
      controller.close()
    },
  })
}

// Helper to build a ReadableStream from raw string chunks (for partial line testing)
function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('checkOllamaStatus', () => {
  it('returns true when /api/tags responds 200', async () => {
    server.use(
      http.get('/api/tags', () => HttpResponse.json({ models: [] }))
    )
    const result = await checkOllamaStatus()
    expect(result).toBe(true)
  })

  it('returns false when fetch fails (network error)', async () => {
    server.use(
      http.get('/api/tags', () => HttpResponse.error())
    )
    const result = await checkOllamaStatus()
    expect(result).toBe(false)
  })
})

describe('fetchModels', () => {
  it('returns model list from valid response', async () => {
    server.use(
      http.get('/api/tags', () =>
        HttpResponse.json({
          models: [
            { name: 'gemma4:e2b', size: 1000, details: { parameter_size: '1.6B', quantization_level: 'Q4', family: 'gemma' } },
            { name: 'llama3', size: 2000, details: { parameter_size: '8B', quantization_level: 'Q4', family: 'llama' } },
          ],
        })
      )
    )
    const models = await fetchModels()
    expect(models).toHaveLength(2)
    expect(models[0].name).toBe('gemma4:e2b')
    expect(models[1].name).toBe('llama3')
  })

  it('returns empty array on non-OK response', async () => {
    server.use(
      http.get('/api/tags', () => new HttpResponse(null, { status: 500 }))
    )
    const models = await fetchModels()
    expect(models).toEqual([])
  })

  it('returns empty array on malformed JSON', async () => {
    server.use(
      http.get('/api/tags', () => new HttpResponse('not json', { status: 200 }))
    )
    const models = await fetchModels()
    expect(models).toEqual([])
  })
})

describe('chatStream', () => {
  it('extracts tokens from NDJSON stream lines', async () => {
    const tokens: string[] = []
    const onToken = (t: string) => tokens.push(t)
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', () =>
        new HttpResponse(
          createNDJSONStream([
            { message: { content: 'Hello' } },
            { message: { content: ' ' } },
            { message: { content: 'World' } },
            { done: true },
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        )
      )
    )

    const abort = await chatStream('test-model', [], {}, onToken, onDone, onError)
    // Wait for the stream to complete
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(tokens).toEqual(['Hello', ' ', 'World'])
    expect(onDone).toHaveBeenCalledWith('Hello World')
    expect(onError).not.toHaveBeenCalled()
    expect(typeof abort).toBe('function')
  })

  it('handles partial line buffering (line split across chunks)', async () => {
    const tokens: string[] = []
    const onToken = (t: string) => tokens.push(t)
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', () =>
        new HttpResponse(
          createChunkedStream([
            '{"message":{"content":"Hel',
            'lo"}}\n{"message":{"content":" World"}}\n{"done":true}\n',
          ])
        )
      )
    )

    await chatStream('test-model', [], {}, onToken, onDone, onError)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(tokens).toEqual(['Hello', ' World'])
    expect(onDone).toHaveBeenCalledWith('Hello World')
  })

  it('calls onDone with accumulated text when done: true', async () => {
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', () =>
        new HttpResponse(
          createNDJSONStream([
            { message: { content: 'Complete' } },
            { done: true },
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        )
      )
    )

    await chatStream('test-model', [], {}, () => {}, onDone, onError)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(onDone).toHaveBeenCalledWith('Complete')
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onError on HTTP error', async () => {
    const onToken = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', () => new HttpResponse(null, { status: 500 }))
    )

    await chatStream('test-model', [], {}, onToken, onDone, onError)
    await vi.waitFor(() => expect(onError).toHaveBeenCalled())

    expect(onToken).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('500') }))
  })

  it('abort function stops the stream', async () => {
    const onToken = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', async () => {
        // Stream that would send data but we'll abort before it finishes
        const encoder = new TextEncoder()
        return new HttpResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"message":{"content":"data"}}\n'))
              // Don't close — leave the stream open
            },
          })
        )
      })
    )

    const abort = await chatStream('test-model', [], {}, onToken, onDone, onError)
    // Call abort immediately — the IIFE's fetch is in-flight
    abort()

    // Give the IIFE time to catch the abort error
    await new Promise((r) => setTimeout(r, 50))

    // The AbortError is caught and logged, no callbacks should fire
    // (onToken might have been called if the first chunk was read before abort)
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('does NOT double-call onDone', async () => {
    // Verifies the fix from Phase 1: onDone must only be called once
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/chat', () =>
        new HttpResponse(
          createChunkedStream([
            // Send done:true WITHOUT a trailing newline so it sits in the buffer
            '{"message":{"content":"done"}}\n{"done":true}',
          ])
        )
      )
    )

    await chatStream('test-model', [], {}, () => {}, onDone, onError)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))

    expect(onDone).toHaveBeenCalledWith('done')
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('pullModelStream', () => {
  it('reports progress from NDJSON lines', async () => {
    const progressUpdates: PullProgress[] = []
    const onProgress = (p: PullProgress) => progressUpdates.push(p)
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/pull', () =>
        new HttpResponse(
          createNDJSONStream([
            { status: 'pulling manifest' },
            { status: 'downloading', digest: 'abc123', total: 100, completed: 30 },
            { status: 'downloading', digest: 'abc123', total: 100, completed: 80 },
            { status: 'success' },
          ]),
          { headers: { 'Content-Type': 'application/x-ndjson' } },
        )
      )
    )

    await pullModelStream('test-model', onProgress, onDone, onError)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(progressUpdates).toHaveLength(4)
    expect(progressUpdates[0].status).toBe('pulling manifest')
    expect(progressUpdates[1].completed).toBe(30)
    expect(progressUpdates[2].completed).toBe(80)
    expect(progressUpdates[3].status).toBe('success')
    expect(onError).not.toHaveBeenCalled()
  })

  it('calls onDone when status is "success"', async () => {
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/pull', () =>
        HttpResponse.json(
          createNDJSONStream([
            { status: 'pulling manifest' },
            { status: 'success' },
          ])
        )
      )
    )

    await pullModelStream('test-model', () => {}, onDone, onError)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())

    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onError).not.toHaveBeenCalled()
  })

  it('abort function stops the pull', async () => {
    const onProgress = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()

    server.use(
      http.post('/api/pull', async () => {
        const encoder = new TextEncoder()
        return new HttpResponse(
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"status":"pulling"}\n'))
              // Leave stream open
            },
          })
        )
      })
    )

    const abort = await pullModelStream('test-model', onProgress, onDone, onError)
    abort()

    await new Promise((r) => setTimeout(r, 50))

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })
})
describe('chatStream error surfacing', () => {
  it('surfaces the Ollama JSON error body instead of a bare status code', async () => {
    server.use(
      http.post('/api/chat', () =>
        HttpResponse.json(
          { error: "model 'bogus' not found, try pulling it first" },
          { status: 404 }
        )
      )
    )

    const onError = vi.fn()
    await new Promise<void>((resolve) => {
      chatStream(
        'bogus',
        [{ role: 'user', content: 'hi' }],
        {},
        () => {},
        () => resolve(),
        (err) => {
          onError(err)
          resolve()
        }
      )
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0].message).toContain('not found, try pulling it first')
  })
})

describe('parseCloudCatalog', () => {
  const fixture = `
    <ul>
      <li x-test-model>
        <span x-test-search-response-title>gpt-oss</span>
        <span x-test-capability>tools</span>
        <span x-test-capability>thinking</span>
        <span class="cloud">cloud</span>
      </li>
      <li x-test-model>
        <span x-test-search-response-title>deepseek-v4-pro</span>
        <span x-test-capability>thinking</span>
      </li>
    </ul>`

  it('extracts cloud model names and capabilities', () => {
    const models = parseCloudCatalog(fixture)
    expect(models).toHaveLength(2)
    expect(models[0]).toEqual({ name: 'gpt-oss', capabilities: ['tools', 'thinking'] })
    expect(models[1].name).toBe('deepseek-v4-pro')
  })

  it('returns an empty array when there are no models', () => {
    expect(parseCloudCatalog('<div>nothing</div>')).toEqual([])
  })
})

describe('parseCloudTags', () => {
  const fixture = `
    <a href="/library/gpt-oss:latest">latest</a>
    <a href="/library/gpt-oss:20b-cloud">20b-cloud</a>
    <a href="/library/gpt-oss:120b-cloud">120b-cloud</a>
    <a href="/library/gpt-oss:120b-cloud">dup</a>`

  it('returns deduped cloud-only tags', () => {
    const tags = parseCloudTags(fixture, 'gpt-oss')
    expect(tags.sort()).toEqual(['gpt-oss:120b-cloud', 'gpt-oss:20b-cloud'])
  })
})
