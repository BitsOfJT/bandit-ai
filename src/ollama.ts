export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  top_p?: number;
  num_ctx?: number;
}

export interface OllamaModel {
  name: string;
  size: number;
  capabilities?: string[];
  details: {
    parameter_size: string;
    quantization_level: string;
    family: string;
  };
}

export interface CloudModel {
  name: string;
  capabilities: string[];
}

/**
 * Extracts the most useful error message from a non-ok Ollama response.
 * Ollama returns JSON like {"error":"model 'x' not found, try pulling it first"},
 * which is far more actionable than a bare status code.
 */
async function ollamaErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.clone().json();
    if (data?.error) return data.error;
  } catch {
    /* body wasn't JSON */
  }
  return `${response.statusText} (${response.status})`;
}

/**
 * Checks if the local Ollama instance is running and reachable.
 */
export async function checkOllamaStatus(): Promise<boolean> {
  try {
    const response = await fetch('/api/tags', { method: 'GET' });
    return response.ok;
  } catch (error) {
    console.error('Ollama connection check failed:', error);
    return false;
  }
}

/**
 * Fetches the list of models currently available in Ollama.
 */
export async function fetchModels(): Promise<OllamaModel[]> {
  try {
    const response = await fetch('/api/tags');
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }
    const data = await response.json();
    return data.models || [];
  } catch (error) {
    console.error('Error fetching Ollama models:', error);
    return [];
  }
}

/**
 * Streams a chat completion response from the local Ollama instance.
 */
export async function chatStream(
  model: string,
  messages: Message[],
  options: ChatOptions,
  onToken: (token: string) => void,
  onDone: (fullText: string) => void,
  onError: (err: Error) => void
): Promise<() => void> {
  const controller = new AbortController();
  const signal = controller.signal;

  let active = true;

  // Cleanup/abort handle returned to caller
  const abort = () => {
    if (active) {
      active = false;
      controller.abort();
    }
  };

  (async () => {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          options: {
            temperature: options.temperature ?? 0.7,
            top_p: options.top_p ?? 0.9,
            num_ctx: options.num_ctx ?? 2048,
          },
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(await ollamaErrorMessage(response));
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported on response body.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedText = '';

      while (active) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.message?.content) {
              const token = parsed.message.content;
              accumulatedText += token;
              onToken(token);
            }
            if (parsed.done) {
              onDone(accumulatedText);
              active = false;
              return;
            }
          } catch (e) {
            console.warn('Failed to parse line:', trimmed, e);
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.message?.content) {
            accumulatedText += parsed.message.content;
            onToken(parsed.message.content);
          }
          if (parsed.done) {
            onDone(accumulatedText);
            active = false;
          }
        } catch (e) {
          console.warn('Failed to flush parse line:', buffer, e);
        }
      }

      if (active) {
        onDone(accumulatedText);
        active = false;
      }
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        console.log('Stream request aborted.');
      } else {
        onError(err);
      }
      active = false;
    }
  })();

  return abort;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

/**
 * Streams the download/pull progress of a model from the local Ollama instance.
 */
export async function pullModelStream(
  model: string,
  onProgress: (progress: PullProgress) => void,
  onDone: () => void,
  onError: (err: Error) => void
): Promise<() => void> {
  const controller = new AbortController();
  const signal = controller.signal;
  let active = true;

  const abort = () => {
    if (active) {
      active = false;
      controller.abort();
    }
  };

  (async () => {
    try {
      const response = await fetch('/api/pull', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: model,
          stream: true,
        }),
        signal,
      });

      if (!response.ok) {
        throw new Error(await ollamaErrorMessage(response));
      }

      if (!response.body) {
        throw new Error('ReadableStream not supported on response body.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (active) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last partial line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as PullProgress;
            onProgress(parsed);
            if (parsed.status === 'success') {
              onDone();
              active = false;
              return;
            }
          } catch (e) {
            console.warn('Failed to parse line:', trimmed, e);
          }
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as PullProgress;
          onProgress(parsed);
          if (parsed.status === 'success') {
            onDone();
            active = false;
          }
        } catch (e) {
          console.warn('Failed to flush parse line:', buffer, e);
        }
      }

      if (active) {
        onDone();
        active = false;
      }
    } catch (error) {
      const err = error as Error;
      if (err.name === 'AbortError') {
        console.log('Pull request aborted.');
      } else {
        onError(err);
      }
      active = false;
    }
  })();

  return abort;
}

/**
 * Parses the Ollama cloud catalog HTML (from /search?c=cloud). Each model is an
 * element carrying the `x-test-model` attribute, with the name in
 * `x-test-search-response-title` and capability badges in `x-test-capability`.
 * Exported for unit testing against a saved fixture.
 */
export function parseCloudCatalog(html: string): CloudModel[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const models: CloudModel[] = [];
  doc.querySelectorAll('[x-test-model]').forEach((li) => {
    const name = li.querySelector('[x-test-search-response-title]')?.textContent?.trim();
    if (!name) return;
    const capabilities = Array.from(li.querySelectorAll('[x-test-capability]'))
      .map((c) => c.textContent?.trim() || '')
      .filter(Boolean);
    models.push({ name, capabilities });
  });
  return models;
}

/**
 * Extracts runnable cloud tags (e.g. gpt-oss:120b-cloud) from a model's
 * /library/<name>/tags page HTML.
 */
export function parseCloudTags(html: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`/library/${escaped}:([a-zA-Z0-9._-]*cloud[a-zA-Z0-9._-]*)`, 'g');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    seen.add(`${name}:${m[1]}`);
  }
  return Array.from(seen);
}

/**
 * Fetches the Ollama cloud model catalog. Routed through the Vite dev proxy
 * (`/ollama-www` -> https://ollama.com) to avoid browser CORS restrictions.
 * Production deployments must mirror this proxy route.
 */
export async function fetchCloudCatalog(): Promise<CloudModel[]> {
  const response = await fetch('/ollama-www/search?c=cloud');
  if (!response.ok) {
    throw new Error(`Failed to fetch cloud catalog (${response.status})`);
  }
  return parseCloudCatalog(await response.text());
}

/**
 * Fetches the runnable cloud tags for a given model name.
 */
export async function fetchCloudTags(name: string): Promise<string[]> {
  const response = await fetch(`/ollama-www/library/${encodeURIComponent(name)}/tags`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tags for ${name} (${response.status})`);
  }
  return parseCloudTags(await response.text(), name);
}

