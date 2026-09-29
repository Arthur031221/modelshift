import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAICompatibleProvider } from "./openai.js";
import type { Provider, ProviderKind } from "./types.js";

export type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  Provider,
  ProviderKind,
  ToolCall,
  ToolDef,
} from "./types.js";
export { ProviderError } from "./types.js";
export { AnthropicProvider, GeminiProvider, OpenAICompatibleProvider };

export interface Preset {
  kind: ProviderKind;
  baseUrl: (env: NodeJS.ProcessEnv) => string;
  keyEnv: string[];
  keyRequired: boolean;
}

export const PRESETS: Record<string, Preset> = {
  openai: {
    kind: "openai",
    baseUrl: (env) => env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    keyEnv: ["OPENAI_API_KEY"],
    keyRequired: true,
  },
  openrouter: {
    kind: "openai",
    baseUrl: () => "https://openrouter.ai/api/v1",
    keyEnv: ["OPENROUTER_API_KEY"],
    keyRequired: true,
  },
  ollama: {
    kind: "openai",
    baseUrl: (env) => `${(env.OLLAMA_HOST ?? "http://localhost:11434").replace(/\/+$/, "")}/v1`,
    keyEnv: ["OLLAMA_API_KEY"],
    keyRequired: false,
  },
  lmstudio: {
    kind: "openai",
    baseUrl: (env) => env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    keyEnv: ["LMSTUDIO_API_KEY"],
    keyRequired: false,
  },
  vllm: {
    kind: "openai",
    baseUrl: (env) => env.VLLM_BASE_URL ?? "http://localhost:8000/v1",
    keyEnv: ["VLLM_API_KEY"],
    keyRequired: false,
  },
  "llama-server": {
    kind: "openai",
    baseUrl: (env) => env.LLAMA_SERVER_BASE_URL ?? "http://localhost:8080/v1",
    keyEnv: ["LLAMA_SERVER_API_KEY"],
    keyRequired: false,
  },
  anthropic: {
    kind: "anthropic",
    baseUrl: (env) => env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    keyEnv: ["ANTHROPIC_API_KEY"],
    keyRequired: true,
  },
  gemini: {
    kind: "gemini",
    baseUrl: (env) => env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    keyRequired: true,
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

/** Guesses the provider preset from the model identifier alone. */
export function guessPreset(model: string): string {
  const lower = model.toLowerCase();
  if (/^(?:anthropic\/)?claude-/.test(lower)) return "anthropic";
  if (
    /^(?:google\/|models\/)?(?:gemini-|imagen-|veo-|text-embedding-00\d|gemini-embedding-)/.test(
      lower,
    )
  )
    return "gemini";
  if (
    /^(?:openai\/)?(?:gpt-|chatgpt-|o[134](?:-|$)|text-embedding-(?:ada|3)|dall-e|whisper|tts-)/.test(
      lower,
    )
  )
    return "openai";
  if (lower.includes("/")) return "openrouter";
  // Ollama style tags (qwen3:4b) and bare local names default to Ollama.
  return "ollama";
}

export interface ResolveOptions {
  model: string;
  preset?: string;
  baseUrl?: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  extraBody?: Record<string, unknown>;
}

export function resolveProvider(options: ResolveOptions): Provider {
  const env = options.env ?? process.env;
  const presetName = options.preset ?? guessPreset(options.model);
  const preset = PRESETS[presetName];
  if (!preset) {
    throw new Error(`Unknown provider "${presetName}". Choose one of: ${PRESET_NAMES.join(", ")}`);
  }
  const baseUrl = options.baseUrl ?? preset.baseUrl(env);
  let apiKey = options.apiKey;
  if (!apiKey) {
    for (const name of preset.keyEnv) {
      if (env[name]) {
        apiKey = env[name];
        break;
      }
    }
  }
  if (!apiKey && preset.keyRequired && !options.baseUrl) {
    throw new Error(
      `No API key for provider "${presetName}". Set ${preset.keyEnv.join(" or ")}, pass --from-key/--to-key, or point --from-base-url/--to-base-url at a local server.`,
    );
  }
  const common = {
    baseUrl,
    apiKey,
    name: presetName,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    extraBody: options.extraBody,
  };
  switch (preset.kind) {
    case "anthropic":
      return new AnthropicProvider(common);
    case "gemini":
      return new GeminiProvider(common);
    default:
      return new OpenAICompatibleProvider(common);
  }
}
