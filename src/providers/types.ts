export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolDef {
  name: string;
  description?: string;
  /** JSON Schema for the arguments. */
  parameters?: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
  temperature?: number;
  /** Ask the provider for a JSON object response where supported. */
  jsonMode?: boolean;
}

export interface ToolCall {
  name: string;
  /** Raw JSON text of the arguments as the provider returned them. */
  arguments: string;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  finishReason: string | null;
  /** True when the provider itself flagged the response as a refusal or safety block. */
  providerRefusal: boolean;
  /** Reasoning text the provider returned separately from the answer, if any. */
  thinking?: string;
}

export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface Provider {
  readonly kind: ProviderKind;
  /** Human readable label such as "ollama" or "openai". */
  readonly name: string;
  readonly baseUrl: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
  embed?(model: string, texts: string[]): Promise<number[][]>;
}

export interface ProviderOptions {
  baseUrl: string;
  apiKey?: string;
  name?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra JSON fields merged into every chat request body. */
  extraBody?: Record<string, unknown>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export async function httpJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    const reason =
      (error as Error).name === "AbortError"
        ? `timed out after ${timeoutMs} ms`
        : (error as Error).message;
    throw new ProviderError(`Request to ${url} failed: ${reason}`);
  }
  clearTimeout(timer);
  const text = await response.text();
  if (!response.ok) {
    throw new ProviderError(
      `HTTP ${response.status} from ${url}: ${text.slice(0, 400)}`,
      response.status,
      text,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(
      `Non-JSON response from ${url}: ${text.slice(0, 200)}`,
      response.status,
      text,
    );
  }
}

export function stripThinkTags(text: string): { text: string; thinking: string } {
  const parts: string[] = [];
  const cleaned = text.replace(/<think>([\s\S]*?)<\/think>\s*/g, (_m, inner: string) => {
    parts.push(inner.trim());
    return "";
  });
  return { text: cleaned.trim(), thinking: parts.join("\n\n") };
}
