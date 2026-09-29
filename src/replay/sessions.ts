import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { redactSecrets } from "../util/secrets.js";
import type { PromptCase } from "./prompts.js";

/**
 * Samples real user turns from local coding-agent logs. Read only. Nothing is uploaded.
 * The sampled prompts are written to a JSONL file for review before any replay runs.
 */

export interface SessionSampleOptions {
  n: number;
  seed?: number;
  claudeDir?: string;
  codexDir?: string;
  minChars?: number;
  maxChars?: number;
}

export interface SampledPrompt extends PromptCase {
  source: string;
  file: string;
}

export interface SessionSampleResult {
  prompts: SampledPrompt[];
  filesScanned: number;
  candidates: number;
  redactions: number;
  sources: string[];
}

const CLAUDE_SKIP = [
  /^<command-name>/,
  /^<local-command/,
  /^<system-reminder>/,
  /^<task-notification>/,
  /^\[Request interrupted/,
  /^Caveat: The messages below/,
  /^<bash-(?:input|stdout|stderr)>/,
];

const CODEX_SKIP = [
  /^<environment_context>/,
  /^<user_instructions>/,
  /^# AGENTS\.md/,
  /^<permissions instructions>/,
];

async function* walkJsonl(dir: string): AsyncGenerator<string> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walkJsonl(full);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) yield full;
  }
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if ((p.type === "text" || p.type === "input_text") && typeof p.text === "string")
      texts.push(p.text);
    if (p.type === "tool_result") return null;
  }
  return texts.length ? texts.join("\n") : null;
}

export function extractClaudeUserText(line: string): string | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (record.type !== "user" || record.isMeta === true) return null;
  const message = record.message as Record<string, unknown> | undefined;
  if (message?.role !== "user") return null;
  const text = textFromContent(message.content);
  if (!text) return null;
  const trimmed = text.trim();
  if (CLAUDE_SKIP.some((re) => re.test(trimmed))) return null;
  return trimmed;
}

export function extractCodexUserText(line: string): string | null {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  let text: string | null = null;
  const payload = record.payload as Record<string, unknown> | undefined;
  if (record.type === "response_item" && payload?.type === "message" && payload.role === "user") {
    text = textFromContent(payload.content);
  } else if (
    record.type === "event_msg" &&
    payload?.type === "user_message" &&
    typeof payload.message === "string"
  ) {
    text = payload.message;
  } else if (record.type === "message" && record.role === "user") {
    text = textFromContent(record.content);
  }
  if (!text) return null;
  const trimmed = text.trim();
  if (CODEX_SKIP.some((re) => re.test(trimmed))) return null;
  return trimmed;
}

/** Deterministic PRNG so a sample can be reproduced with --seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function sampleSessions(options: SessionSampleOptions): Promise<SessionSampleResult> {
  const home = os.homedir();
  const claudeDir = options.claudeDir ?? path.join(home, ".claude", "projects");
  const codexDir = options.codexDir ?? path.join(home, ".codex", "sessions");
  const minChars = options.minChars ?? 20;
  const maxChars = options.maxChars ?? 4000;
  const sources: string[] = [];
  const pool: Array<{ text: string; source: string; file: string }> = [];
  const seen = new Set<string>();
  let filesScanned = 0;

  const collect = async (dir: string, source: string, extract: (line: string) => string | null) => {
    let any = false;
    for await (const file of walkJsonl(dir)) {
      any = true;
      filesScanned += 1;
      let content: string;
      try {
        content = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        const text = extract(line);
        if (!text || text.length < minChars || text.length > maxChars) continue;
        const key = text.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);
        pool.push({ text, source, file: path.basename(file) });
      }
    }
    if (any) sources.push(source);
  };

  await collect(claudeDir, "claude-code", extractClaudeUserText);
  await collect(codexDir, "codex", extractCodexUserText);

  const rand = mulberry32(options.seed ?? Date.now() % 2_147_483_647);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  let redactions = 0;
  const prompts: SampledPrompt[] = shuffled.slice(0, options.n).map((item, i) => {
    const redacted = redactSecrets(item.text);
    redactions += redacted.redactions;
    return {
      id: `session-${String(i + 1).padStart(3, "0")}`,
      messages: [{ role: "user", content: redacted.text }],
      source: item.source,
      file: item.file,
    };
  });
  return { prompts, filesScanned, candidates: pool.length, redactions, sources };
}

export function sampledToJsonl(prompts: SampledPrompt[]): string {
  return `${prompts
    .map((p) =>
      JSON.stringify({ id: p.id, prompt: p.messages[0]!.content, source: p.source, file: p.file }),
    )
    .join("\n")}\n`;
}
