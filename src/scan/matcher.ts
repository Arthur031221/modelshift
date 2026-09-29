/**
 * Finds strings that look like model identifiers in source text.
 *
 * The matcher is deliberately conservative. Strongly prefixed families
 * (gpt-4..., claude-..., gemini-..., anthropic.claude-...) match anywhere.
 * Short or ambiguous forms (o1, o3, Ollama tags such as qwen3:4b) only match
 * inside quotes so that variable names and prose do not produce noise.
 */

export type ProviderGuess = "openai" | "anthropic" | "google" | "bedrock" | "ollama" | "unknown";

export interface Candidate {
  id: string;
  line: number;
  column: number;
  provider: ProviderGuess;
  quoted: boolean;
}

interface Family {
  re: RegExp;
  provider: ProviderGuess;
  requireQuote?: boolean;
  /** Extra check applied to the trimmed id. */
  accept?: (id: string) => boolean;
}

const TAIL = "[A-Za-z0-9._@:-]*";
const LEFT = "(?<![A-Za-z0-9_.-])";

const FAMILIES: Family[] = [
  {
    // Bedrock IDs, optionally prefixed by an inference profile region such as us. or global.
    re: new RegExp(
      `${LEFT}(?:(?:us|eu|apac|global|jp|au|ca|sa|us-gov)\\.)?(?:anthropic|amazon|meta|mistral|cohere|ai21|stability|twelvelabs|deepseek|writer|luma|qwen|openai|google|nvidia|minimax|moonshotai)\\.(?:claude|nova|titan|llama|mistral|mixtral|pixtral|ministral|command|embed|jamba|marengo|pegasus|r1|v3|palmyra|ray|qwen|gpt-oss|nemotron|kimi|gemma|stable|sd3)${TAIL}`,
      "g",
    ),
    provider: "bedrock",
  },
  {
    re: new RegExp(`${LEFT}claude-${TAIL}`, "g"),
    provider: "anthropic",
    accept: (id) => /^claude-(?:\d|instant|opus|sonnet|haiku|fable|mythos)/.test(id),
  },
  {
    re: new RegExp(
      `${LEFT}(?:gpt-\\d|chatgpt-|gpt-image-|gpt-realtime|gpt-audio|gpt-transcribe|gpt-live|gpt-oss)${TAIL}`,
      "g",
    ),
    provider: "openai",
    accept: (id) => !/^gpt-\d+$/.test(id) || /^gpt-[345]$/.test(id),
  },
  {
    re: new RegExp(`${LEFT}(?:o1|o3|o4)(?:-(?:mini|pro|preview|deep-research)${TAIL})`, "g"),
    provider: "openai",
  },
  {
    re: new RegExp(`${LEFT}(?:o1|o3)(?:-20\\d\\d-\\d\\d-\\d\\d)?(?![A-Za-z0-9._-])`, "g"),
    provider: "openai",
    requireQuote: true,
  },
  {
    re: new RegExp(
      `${LEFT}(?:text-embedding-(?:ada-002|3-small|3-large)|text-davinci-00\\d|text-moderation-${TAIL}|omni-moderation-${TAIL}|dall-e-[23]|whisper-1|tts-1(?:-hd)?|sora-${TAIL}|codex-mini-latest|computer-use-preview|davinci-002|babbage-002)`,
      "g",
    ),
    provider: "openai",
    requireQuote: true,
  },
  {
    re: new RegExp(`${LEFT}(?:gemini-|imagen-|veo-|gemini-embedding-)${TAIL}`, "g"),
    provider: "google",
    accept: (id) => !/^gemini-(?:cli|api|extension)/.test(id),
  },
  {
    re: new RegExp(
      `${LEFT}(?:text-embedding-00\\d|embedding-001|text-bison${TAIL}|chat-bison${TAIL})`,
      "g",
    ),
    provider: "google",
    requireQuote: true,
  },
  {
    // Ollama style tags: qwen3:4b, llama3.1:8b-instruct-q4_K_M
    re: new RegExp(
      `${LEFT}(?:qwen|llama|mistral|deepseek|gemma|phi|mixtral|gpt-oss|codellama|nomic-embed|mxbai-embed|granite|glm|smollm|tinyllama)[A-Za-z0-9._-]*:[A-Za-z0-9._-]+`,
      "g",
    ),
    provider: "ollama",
    requireQuote: true,
  },
];

const IGNORE_MARK = "modelshift:ignore";
const QUOTE = /['"`]/;

function trimTail(id: string): string {
  return id.replace(/[.,:;'"`)\]}]+$/, "");
}

function insideUrl(line: string, start: number): boolean {
  let i = start - 1;
  while (i >= 0 && !/[\s'"`(<[{,]/.test(line[i]!)) i -= 1;
  return line.slice(i + 1, start).includes("://");
}

function isQuoted(line: string, start: number, end: number): boolean {
  // Allow a vendor path prefix such as openai/ or models/ between the quote and the id.
  let i = start - 1;
  while (i >= 0 && /[A-Za-z0-9_./-]/.test(line[i]!)) i -= 1;
  const before = i >= 0 ? line[i]! : "";
  const after = end < line.length ? line[end]! : "";
  return QUOTE.test(before) || QUOTE.test(after);
}

export function findCandidatesInLine(line: string, lineNumber: number): Candidate[] {
  if (line.includes(IGNORE_MARK)) return [];
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const family of FAMILIES) {
    family.re.lastIndex = 0;
    let match: RegExpExecArray | null = family.re.exec(line);
    while (match) {
      const rawStart = match.index;
      const id = trimTail(match[0]);
      const end = rawStart + id.length;
      family.re.lastIndex = rawStart + Math.max(1, match[0].length);
      match = family.re.exec(line);
      if (id.length < 2) continue;
      if (family.accept && !family.accept(id)) continue;
      if (insideUrl(line, rawStart)) continue;
      const quoted = isQuoted(line, rawStart, end);
      if (family.requireQuote && !quoted) continue;
      const key = `${id}@${rawStart}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ id, line: lineNumber, column: rawStart + 1, provider: family.provider, quoted });
    }
  }
  return found.sort((a, b) => a.column - b.column);
}

export function findCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.length > 4000) continue;
    out.push(...findCandidatesInLine(line, i + 1));
  }
  return out;
}
