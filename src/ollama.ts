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
  details: {
    parameter_size: string;
    quantization_level: string;
    family: string;
  };
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
        throw new Error(`Ollama Chat Error: ${response.statusText} (${response.status})`);
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
        throw new Error(`Ollama Pull Error: ${response.statusText} (${response.status})`);
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

