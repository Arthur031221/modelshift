import {
  type ChatRequest,
  type ChatResponse,
  httpJson,
  type Provider,
  ProviderError,
  type ProviderOptions,
  type ToolCall,
} from "./types.js";

interface OllamaChat {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{ function?: { name?: string; arguments?: unknown } }>;
  };
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaEmbed {
  embeddings?: number[][];
}

/**
 * Ollama's native API. Used instead of the OpenAI-compatible endpoint when the
 * caller wants `think: false`, which the compatible endpoint does not honour.
 */
export class OllamaNativeProvider implements Provider {
  readonly kind = "openai" as const;
  readonly name: string;
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly think: boolean;

  constructor(options: ProviderOptions & { think?: boolean }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
    this.name = options.name ?? "ollama";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.think = options.think ?? false;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      think: this.think,
      options: {
        ...(request.maxTokens !== undefined ? { num_predict: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
    };
    const hasTools = Boolean(request.tools && request.tools.length > 0);
    if (hasTools) {
      body.tools = request.tools!.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters: t.parameters ?? { type: "object", properties: {} },
        },
      }));
    }
    if (request.jsonMode && !hasTools) body.format = "json";
    const started = performance.now();
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
    )) as OllamaChat;
    const latencyMs = Math.round(performance.now() - started);
    const message = data.message;
    if (!message)
      throw new ProviderError("Response contained no message", undefined, JSON.stringify(data));
    const toolCalls: ToolCall[] = (message.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c) => ({
        name: c.function!.name!,
        arguments:
          typeof c.function!.arguments === "string"
            ? c.function!.arguments
            : JSON.stringify(c.function!.arguments ?? {}),
      }));
    return {
      text: (message.content ?? "").trim(),
      toolCalls,
      inputTokens: data.prompt_eval_count ?? null,
      outputTokens: data.eval_count ?? null,
      latencyMs,
      finishReason: data.done_reason ?? null,
      providerRefusal: false,
      thinking: message.thinking || undefined,
    };
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/api/embed`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, input: texts }),
      },
      this.timeoutMs,
    )) as OllamaEmbed;
    const vectors = data.embeddings ?? [];
    if (vectors.length !== texts.length) {
      throw new ProviderError(`Expected ${texts.length} embeddings, received ${vectors.length}`);
    }
    return vectors;
  }
}
