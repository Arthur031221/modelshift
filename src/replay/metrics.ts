import type { ToolCall, ToolDef } from "../providers/types.js";

const REFUSAL_PATTERNS: RegExp[] = [
  /\bI(?:'m| am) (?:sorry|afraid),? (?:but )?I (?:can(?:'t|not)|won(?:'t|'t)|am (?:not able|unable))/i,
  /\bI (?:can(?:'t|not)|won't|am unable to|'m unable to|'m not able to) (?:help|assist|provide|comply|do that|create|write|generate|fulfil|fulfill|support)/i,
  /\bI cannot (?:assist|help|provide|comply)/i,
  /\bI(?:'m| am) not able to (?:help|assist|provide)/i,
  /\bas an ai(?: language model)?,? I (?:can(?:'t|not)|am unable|do not|don't)/i,
  /\bI must (?:decline|refuse)/i,
  /\bI(?:'m| am) (?:unable|not going) to (?:help|assist|provide|do)/i,
  /\b(?:this|that) (?:request|goes) (?:is )?against (?:my|our) (?:guidelines|policies|principles)/i,
  /\bI (?:do not|don't) (?:feel comfortable|think I should|assist with)/i,
  /\bnot something I can help with/i,
  /\bI(?:'d| would) (?:rather not|prefer not to)/i,
  /\b(?:illegal|unethical|harmful)\b.{0,60}\bI (?:can(?:'t|not)|won't)/i,
];

/** Simple phrase classifier. Looks at the first 600 characters where refusals usually appear. */
export function isRefusal(text: string): boolean {
  const head = text.slice(0, 600);
  return REFUSAL_PATTERNS.some((re) => re.test(head));
}

export interface JsonCheck {
  valid: boolean;
  /** True when the whole output parsed as-is, false when JSON had to be extracted from prose or fences. */
  strict: boolean;
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1] ? fenced[1].trim() : text.trim();
}

export function checkJson(text: string): JsonCheck {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return { valid: true, strict: true };
  } catch {
    // fall through
  }
  const unfenced = stripFences(trimmed);
  try {
    JSON.parse(unfenced);
    return { valid: true, strict: false };
  } catch {
    // fall through
  }
  const start = unfenced.search(/[[{]/);
  if (start >= 0) {
    const lastBrace = Math.max(unfenced.lastIndexOf("}"), unfenced.lastIndexOf("]"));
    if (lastBrace > start) {
      try {
        JSON.parse(unfenced.slice(start, lastBrace + 1));
        return { valid: true, strict: false };
      } catch {
        // fall through
      }
    }
  }
  return { valid: false, strict: false };
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function termFrequencies(text: string): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/** Cosine similarity over term frequencies. 1 for identical bags of words, 0 for disjoint. */
export function lexicalSimilarity(a: string, b: string): number {
  const ta = termFrequencies(a);
  const tb = termFrequencies(b);
  if (ta.size === 0 || tb.size === 0) return ta.size === tb.size ? 1 : 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [term, count] of ta) {
    na += count * count;
    const other = tb.get(term);
    if (other) dot += count * other;
  }
  for (const count of tb.values()) nb += count * count;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface ToolShape {
  called: string[];
  unknownTools: string[];
  argsParse: boolean;
  missingRequired: string[];
}

export function toolShape(calls: ToolCall[], tools: ToolDef[] | undefined): ToolShape {
  const known = new Map((tools ?? []).map((t) => [t.name, t]));
  const called = calls.map((c) => c.name);
  const unknownTools = called.filter((name) => tools && !known.has(name));
  let argsParse = true;
  const missingRequired: string[] = [];
  for (const call of calls) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(call.arguments || "{}");
    } catch {
      argsParse = false;
      continue;
    }
    const def = known.get(call.name);
    const required = (def?.parameters?.required as unknown) ?? [];
    if (Array.isArray(required) && parsed && typeof parsed === "object") {
      for (const key of required) {
        if (typeof key === "string" && !(key in (parsed as Record<string, unknown>)))
          missingRequired.push(`${call.name}.${key}`);
      }
    }
  }
  return { called, unknownTools, argsParse, missingRequired };
}

export function sameToolShape(a: ToolShape, b: ToolShape): boolean {
  const sa = [...a.called].sort().join(",");
  const sb = [...b.called].sort().join(",");
  return (
    sa === sb &&
    a.argsParse === b.argsParse &&
    a.missingRequired.length === b.missingRequired.length
  );
}
