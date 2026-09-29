import {
  type ChatRequest,
  type ChatResponse,
  httpJson,
  type Provider,
  ProviderError,
  type ProviderOptions,
  type ToolCall,
} from "./types.js";

interface AnthropicBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
}

interface AnthropicMessage {
  content?: AnthropicBlock[];
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Anthropic Messages API. */
export class AnthropicProvider implements Provider {
  readonly kind = "anthropic" as const;
  readonly name: string;
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly extraBody: Record<string, unknown>;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.name = options.name ?? "anthropic";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.extraBody = options.extraBody ?? {};
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new ProviderError(
        "ANTHROPIC_API_KEY is not set. Pass --from-key or --to-key, or export the variable.",
      );
    }
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      model: request.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content })),
      ...this.extraBody,
    };
    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.parameters ?? { type: "object", properties: {} },
      }));
    }
    const started = performance.now();
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      },
      this.timeoutMs,
    )) as AnthropicMessage;
    const latencyMs = Math.round(performance.now() - started);
    const blocks = data.content ?? [];
    const text = blocks
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    const thinking = blocks
      .filter((b) => b.type === "thinking" && typeof b.thinking === "string")
      .map((b) => b.thinking as string)
      .join("\n\n");
    const toolCalls: ToolCall[] = blocks
      .filter((b) => b.type === "tool_use" && typeof b.name === "string")
      .map((b) => ({ name: b.name as string, arguments: JSON.stringify(b.input ?? {}) }));
    return {
      text: text.trim(),
      toolCalls,
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
      latencyMs,
      finishReason: data.stop_reason ?? null,
      providerRefusal: data.stop_reason === "refusal",
      thinking: thinking || undefined,
    };
  }
}
