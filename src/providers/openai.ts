import {
  type ChatRequest,
  type ChatResponse,
  httpJson,
  type Provider,
  ProviderError,
  type ProviderOptions,
  stripThinkTags,
  type ToolCall,
} from "./types.js";

interface OpenAIChoice {
  message?: {
    content?: string | null;
    refusal?: string | null;
    reasoning?: string | null;
    reasoning_content?: string | null;
    tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
  };
  finish_reason?: string | null;
}

interface OpenAIChatCompletion {
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIEmbeddings {
  data?: Array<{ embedding?: number[] }>;
}

/**
 * Talks to any server that implements the OpenAI chat completions API:
 * OpenAI, OpenRouter, Ollama, LM Studio, llama-server, vLLM.
 */
export class OpenAICompatibleProvider implements Provider {
  readonly kind = "openai" as const;
  readonly name: string;
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly extraBody: Record<string, unknown>;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.name = options.name ?? "openai";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.extraBody = options.extraBody ?? {};
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  private get isOfficialOpenAI(): boolean {
    return /api\.openai\.com/.test(this.baseUrl);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      ...this.extraBody,
    };
    if (request.maxTokens !== undefined) {
      body[this.isOfficialOpenAI ? "max_completion_tokens" : "max_tokens"] = request.maxTokens;
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters: t.parameters ?? { type: "object", properties: {} },
        },
      }));
    }
    if (request.jsonMode && !(request.tools && request.tools.length > 0)) {
      body.response_format = { type: "json_object" };
    }
    const started = performance.now();
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
      this.timeoutMs,
    )) as OpenAIChatCompletion;
    const latencyMs = Math.round(performance.now() - started);
    const choice = data.choices?.[0];
    if (!choice)
      throw new ProviderError("Response contained no choices", undefined, JSON.stringify(data));
    const message = choice.message ?? {};
    const rawText = typeof message.content === "string" ? message.content : "";
    const stripped = stripThinkTags(rawText);
    const separateReasoning = message.reasoning ?? message.reasoning_content ?? "";
    const toolCalls: ToolCall[] = (message.tool_calls ?? [])
      .filter((c) => c.function?.name)
      .map((c) => ({ name: c.function!.name!, arguments: c.function!.arguments ?? "{}" }));
    const refusal = typeof message.refusal === "string" && message.refusal.length > 0;
    return {
      text: refusal && !stripped.text ? (message.refusal as string) : stripped.text,
      toolCalls,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      latencyMs,
      finishReason: choice.finish_reason ?? null,
      providerRefusal: refusal || choice.finish_reason === "content_filter",
      thinking: [separateReasoning, stripped.thinking].filter(Boolean).join("\n\n") || undefined,
    };
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/embeddings`,
      { method: "POST", headers: this.headers(), body: JSON.stringify({ model, input: texts }) },
      this.timeoutMs,
    )) as OpenAIEmbeddings;
    const vectors = (data.data ?? []).map((d) => d.embedding ?? []);
    if (vectors.length !== texts.length) {
      throw new ProviderError(`Expected ${texts.length} embeddings, received ${vectors.length}`);
    }
    return vectors;
  }
}
