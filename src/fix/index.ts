import path from "node:path";
import { createTwoFilesPatch } from "diff";
import type { RegistryIndex } from "../registry/index.js";
import { type Finding, scanText } from "../scan/index.js";
import { DEFAULT_EXTENSIONS, readTextFile, walkFiles } from "../scan/walker.js";

export const PARAM_RULE_CITATION =
  'Anthropic, "Model deprecations", section "API parameter deprecations": temperature, top_p and top_k return a 400 error when set to a non-default value on Claude 4.7 and later models. https://platform.claude.com/docs/en/about-claude/model-deprecations#api-parameter-deprecations';

export const PROMPT_RULE_CITATION =
  'Anthropic, "Prompting best practices", section "Leverage thinking & interleaved thinking capabilities": prefer general instructions over prescriptive steps, and treat manual chain-of-thought prompting as a fallback for when thinking is off. https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices';

/** Models that reject non-default sampling parameters. */
export const NO_SAMPLING_PARAMS =
  /claude-(?:opus-4-[78]|opus-5(?:-5)?|sonnet-5(?:-5)?|fable-5(?:-1)?|mythos-5(?:-1)?|mythos-preview)(?![0-9])/i;

const PARAM_LINE =
  /^\s*["']?(?:temperature|top_p|top_k|topP|topK|TopP|TopK|Temperature)["']?\s*[:=]\s*(?:anthropic\.(?:Float|Int)\()?[-+]?\d*\.?\d+\)?\s*,?\s*(?:#.*|\/\/.*)?$/;
const JAVA_PARAM_LINE = /^\s*\.(?:temperature|topP|topK)\([^)]*\)\s*$/;
const INLINE_PARAM_TRAILING = /,\s*["']?(?:temperature|top_p|top_k)["']?\s*[:=]\s*[-+]?\d*\.?\d+/g;
const INLINE_PARAM_LEADING =
  /(?<=[(,{]\s*)["']?(?:temperature|top_p|top_k)["']?\s*[:=]\s*[-+]?\d*\.?\d+\s*,\s*/g;

const PROMPT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /think step[- ]by[- ]step/i, label: "think step by step" },
  { re: /let'?s think step/i, label: "let's think step by step" },
  { re: /step[- ]by[- ]step reasoning/i, label: "step-by-step reasoning" },
  { re: /take a deep breath/i, label: "take a deep breath" },
  { re: /<scratchpad>/i, label: "<scratchpad> tag" },
  { re: /<thinking>/i, label: "<thinking> tag" },
  { re: /show your (?:reasoning|work)/i, label: "show your reasoning" },
  { re: /reason(?:ing)? (?:out loud|aloud)/i, label: "reason out loud" },
  {
    re: /think (?:carefully|thoroughly) (?:through|about) (?:this|it|the (?:problem|question)) step/i,
    label: "think through step by step",
  },
];

export interface Rewrite {
  line: number;
  from: string;
  to: string;
  status: Finding["status"];
}

export interface StrippedParam {
  line: number;
  text: string;
  model: string;
}

export interface FileChange {
  file: string;
  absolutePath: string;
  before: string;
  after: string;
  rewrites: Rewrite[];
  strippedParams: StrippedParam[];
}

export interface PromptFlag {
  file: string;
  line: number;
  text: string;
  pattern: string;
}

export interface Skipped {
  file: string;
  line: number;
  id: string;
  reason: string;
}

export interface FixPlan {
  changes: FileChange[];
  flags: PromptFlag[];
  skipped: Skipped[];
  filesScanned: number;
}

export interface FixOptions {
  root: string;
  days: number;
  today: string;
  index: RegistryIndex;
  includeEligible?: boolean;
  respectGitignore?: boolean;
}

const REWRITE_STATUSES = new Set<Finding["status"]>(["retired", "retiring", "deprecated"]);

function shouldRewrite(f: Finding, includeEligible: boolean): boolean {
  if (!f.replacement) return false;
  if (REWRITE_STATUSES.has(f.status)) return true;
  return includeEligible && f.status === "eligible";
}

/** Replaces retiring identifiers on one line, right to left so columns stay valid. */
function rewriteLine(
  line: string,
  findings: Finding[],
  includeEligible: boolean,
): { line: string; rewrites: Rewrite[]; skipped: Skipped[] } {
  const rewrites: Rewrite[] = [];
  const skipped: Skipped[] = [];
  let out = line;
  const ordered = [...findings].sort((a, b) => b.column - a.column);
  for (const f of ordered) {
    if (!shouldRewrite(f, includeEligible)) {
      if (REWRITE_STATUSES.has(f.status) && !f.replacement) {
        skipped.push({
          file: f.file,
          line: f.line,
          id: f.id,
          reason: "provider names no replacement",
        });
      }
      continue;
    }
    const start = f.column - 1;
    if (out.slice(start, start + f.id.length) !== f.id) continue;
    const replacement = f.replacement!;
    if (replacement === f.id) continue;
    out = out.slice(0, start) + replacement + out.slice(start + f.id.length);
    rewrites.push({ line: f.line, from: f.id, to: replacement, status: f.status });
  }
  return { line: out, rewrites, skipped };
}

function isBlockBoundary(line: string): boolean {
  return (
    line.trim() === "" ||
    /^\s*(?:def |async def |function |class |export |import |from |const |let |var |package |func )/.test(
      line,
    )
  );
}

/** Removes sampling parameters near lines that name a model which rejects them. */
export function stripSamplingParams(lines: string[]): {
  lines: string[];
  stripped: StrippedParam[];
} {
  const out = [...lines];
  const stripped: StrippedParam[] = [];
  const removed = new Set<number>();
  for (let i = 0; i < out.length; i += 1) {
    const modelMatch = out[i]!.match(NO_SAMPLING_PARAMS);
    if (!modelMatch) continue;
    const model = modelMatch[0];
    // Same line, for example client.messages.create(model="...", temperature=0.7)
    const before = out[i]!;
    let after = before.replace(INLINE_PARAM_TRAILING, "");
    after = after.replace(INLINE_PARAM_LEADING, "");
    if (after !== before) {
      out[i] = after;
      stripped.push({ line: i + 1, text: before.trim(), model });
    }
    // Neighbouring lines within the same block.
    for (const direction of [-1, 1]) {
      for (
        let j = i + direction, steps = 0;
        j >= 0 && j < out.length && steps < 25;
        j += direction, steps += 1
      ) {
        const candidate = out[j]!;
        if (isBlockBoundary(candidate)) break;
        if (removed.has(j)) continue;
        if (PARAM_LINE.test(candidate) || JAVA_PARAM_LINE.test(candidate)) {
          removed.add(j);
          stripped.push({ line: j + 1, text: candidate.trim(), model });
        }
      }
    }
  }
  const kept = out.filter((_, i) => !removed.has(i));
  return { lines: kept, stripped: stripped.sort((a, b) => a.line - b.line) };
}

const FLAG_EXTENSIONS = new Set([...DEFAULT_EXTENSIONS].filter((e) => e !== ".md"));

export function findPromptFlags(text: string, file: string): PromptFlag[] {
  if (!/claude-|anthropic\.claude/i.test(text)) return [];
  if (
    !FLAG_EXTENSIONS.has(path.extname(file).toLowerCase()) &&
    !path.basename(file).startsWith(".env")
  )
    return [];
  const flags: PromptFlag[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, label } of PROMPT_PATTERNS) {
      if (re.test(line)) {
        flags.push({ file, line: i + 1, text: line.trim().slice(0, 160), pattern: label });
        break;
      }
    }
  });
  return flags;
}

export function planFileFix(
  text: string,
  file: string,
  absolutePath: string,
  options: FixOptions,
): { change: FileChange | null; flags: PromptFlag[]; skipped: Skipped[] } {
  const findings = scanText(text, file, absolutePath, options);
  const byLine = new Map<number, Finding[]>();
  for (const f of findings) {
    const list = byLine.get(f.line) ?? [];
    list.push(f);
    byLine.set(f.line, list);
  }
  const lines = text.split(/\r?\n/);
  const rewrites: Rewrite[] = [];
  const skipped: Skipped[] = [];
  const rewritten = lines.map((line, i) => {
    const hits = byLine.get(i + 1);
    if (!hits) return line;
    const result = rewriteLine(line, hits, Boolean(options.includeEligible));
    rewrites.push(...result.rewrites);
    skipped.push(...result.skipped);
    return result.line;
  });
  const { lines: finalLines, stripped } = stripSamplingParams(rewritten);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const after = finalLines.join(eol);
  const flags = findPromptFlags(after, file);
  if (after === text) return { change: null, flags, skipped };
  return {
    change: { file, absolutePath, before: text, after, rewrites, strippedParams: stripped },
    flags,
    skipped,
  };
}

export async function planFix(options: FixOptions): Promise<FixPlan> {
  const root = path.resolve(options.root);
  const changes: FileChange[] = [];
  const flags: PromptFlag[] = [];
  const skipped: Skipped[] = [];
  let filesScanned = 0;
  for await (const file of walkFiles({
    root,
    respectGitignore: options.respectGitignore ?? true,
  })) {
    const text = await readTextFile(file);
    if (text === null) continue;
    filesScanned += 1;
    const rel = path.relative(root, file).split(path.sep).join("/") || path.basename(file);
    const result = planFileFix(text, rel, file, options);
    if (result.change) changes.push(result.change);
    flags.push(...result.flags);
    skipped.push(...result.skipped);
  }
  return { changes, flags, skipped, filesScanned };
}

export function renderUnifiedDiff(plan: FixPlan): string {
  return plan.changes
    .map((c) =>
      createTwoFilesPatch(`a/${c.file}`, `b/${c.file}`, c.before, c.after, "", "", { context: 3 }),
    )
    .join("\n");
}

export async function applyFix(plan: FixPlan): Promise<number> {
  const { promises: fs } = await import("node:fs");
  for (const change of plan.changes) {
    await fs.writeFile(change.absolutePath, change.after, "utf8");
  }
  return plan.changes.length;
}
