import { readFileSync } from "node:fs";
import { packageRegistryFile, type RegistryIndex } from "../registry/index.js";

export interface Price {
  input: number;
  output: number;
}

export interface PriceTable {
  generated: string;
  unit: string;
  sources: Record<string, string>;
  prices: Record<string, Price>;
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "vllm", "llama-server"]);

export function defaultPricesPath(): string {
  return packageRegistryFile("prices.json");
}

export function loadPrices(file?: string): PriceTable {
  const raw = readFileSync(file ?? defaultPricesPath(), "utf8");
  return JSON.parse(raw) as PriceTable;
}

function stripDate(id: string): string {
  return id.replace(/-20\d{2}-\d{2}-\d{2}$/, "").replace(/-20\d{6}$/, "");
}

/** Price per million tokens for a model, or null when unknown. Local servers are free. */
export function priceFor(
  model: string,
  providerName: string,
  table: PriceTable,
  index?: RegistryIndex,
): Price | null {
  if (LOCAL_PROVIDERS.has(providerName)) return { input: 0, output: 0 };
  const candidates = new Set<string>();
  const bare = model.replace(/^(?:openai|anthropic|google|models)\//, "");
  candidates.add(bare);
  candidates.add(stripDate(bare));
  const entry = index?.lookup(bare)?.entry;
  if (entry) {
    candidates.add(entry.id);
    candidates.add(stripDate(entry.id));
    for (const alias of entry.aliases) candidates.add(alias);
  }
  for (const c of candidates) {
    const hit = table.prices[c] ?? table.prices[c.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

export function costUsd(
  price: Price | null,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  if (!price || inputTokens === null || outputTokens === null) return null;
  return (inputTokens / 1_000_000) * price.input + (outputTokens / 1_000_000) * price.output;
}
