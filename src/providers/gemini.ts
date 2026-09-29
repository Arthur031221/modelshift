import {
  type ChatRequest,
  type ChatResponse,
  httpJson,
  type Provider,
  ProviderError,
  type ProviderOptions,
  type ToolCall,
} from "./types.js";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: unknown };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface GeminiEmbeddings {
  embeddings?: Array<{ values?: number[] }>;
}

/** Google Gemini API (generativelanguage.googleapis.com). */
export class GeminiProvider implements Provider {
  readonly kind = "gemini" as const;
  readonly name: string;
  readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly extraBody: Record<string, unknown>;

  constructor(options: ProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.name = options.name ?? "gemini";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.extraBody = options.extraBody ?? {};
  }

  private headers(): Record<string, string> {
    if (!this.apiKey) {
      throw new ProviderError(
        "GEMINI_API_KEY is not set. Pass --from-key or --to-key, or export the variable.",
      );
    }
    return { "content-type": "application/json", "x-goog-api-key": this.apiKey };
  }

  private modelPath(model: string): string {
    return model.startsWith("models/") ? model : `models/${model}`;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const system = request.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const body: Record<string, unknown> = {
      contents: request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      ...this.extraBody,
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
    if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
    const hasTools = Boolean(request.tools && request.tools.length > 0);
    if (request.jsonMode && !hasTools) generationConfig.responseMimeType = "application/json";
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;
    if (hasTools) {
      body.tools = [
        {
          functionDeclarations: request.tools!.map((t) => ({
            name: t.name,
            description: t.description ?? "",
            parameters: t.parameters ?? { type: "object", properties: {} },
          })),
        },
      ];
    }
    const started = performance.now();
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/v1beta/${this.modelPath(request.model)}:generateContent`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
      this.timeoutMs,
    )) as GeminiResponse;
    const latencyMs = Math.round(performance.now() - started);
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text as string)
      .join("");
    const thinking = parts
      .filter((p) => typeof p.text === "string" && p.thought)
      .map((p) => p.text as string)
      .join("\n\n");
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({
        name: p.functionCall!.name!,
        arguments: JSON.stringify(p.functionCall!.args ?? {}),
      }));
    const blocked =
      Boolean(data.promptFeedback?.blockReason) || candidate?.finishReason === "SAFETY";
    return {
      text: text.trim(),
      toolCalls,
      inputTokens: data.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
      latencyMs,
      finishReason: candidate?.finishReason ?? data.promptFeedback?.blockReason ?? null,
      providerRefusal: blocked,
      thinking: thinking || undefined,
    };
  }

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const path = this.modelPath(model);
    const data = (await httpJson(
      this.fetchImpl,
      `${this.baseUrl}/v1beta/${path}:batchEmbedContents`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          requests: texts.map((text) => ({ model: path, content: { parts: [{ text }] } })),
        }),
      },
      this.timeoutMs,
    )) as GeminiEmbeddings;
    const vectors = (data.embeddings ?? []).map((e) => e.values ?? []);
    if (vectors.length !== texts.length) {
      throw new ProviderError(`Expected ${texts.length} embeddings, received ${vectors.length}`);
    }
    return vectors;
  }
}
