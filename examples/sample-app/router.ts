export const MODELS = {
  fast: "gpt-4.1-nano",
  reasoning: "o3-mini",
  writer: "claude-sonnet-4-5",
  embeddings: "text-embedding-3-small",
} as const;

export function pick(task: "fast" | "reasoning" | "writer"): string {
  return MODELS[task];
}
