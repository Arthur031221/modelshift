import path from "node:path";
import {
  computeStatus,
  type LifecycleEntry,
  type RegistryIndex,
  STATUS_ORDER,
  type Status,
} from "../registry/index.js";
import { type Candidate, findCandidates, type ProviderGuess } from "./matcher.js";
import { DEFAULT_EXTENSIONS, readTextFile, walkFiles } from "./walker.js";

export interface Classification {
  /** Registry key that matched, or null when the id is not in the registry. */
  matchedKey: string | null;
  provider: string;
  status: Status;
  daysLeft: number | null;
  date: string | null;
  /** Final replacement after following the chain of retired successors. */
  replacement: string | null;
  /** Replacement exactly as the provider printed it. */
  directReplacement: string | null;
  source: string | null;
  notes: string | null;
  entry: LifecycleEntry | null;
}

export interface Finding extends Classification {
  file: string;
  absolutePath: string;
  line: number;
  column: number;
  id: string;
  quoted: boolean;
}

export interface ScanOptions {
  root: string;
  days: number;
  today: string;
  index: RegistryIndex;
  respectGitignore?: boolean;
  extensions?: ReadonlySet<string>;
}

export interface ScanResult {
  root: string;
  today: string;
  days: number;
  registryVersion: string;
  filesScanned: number;
  durationMs: number;
  findings: Finding[];
  counts: Record<Status, number>;
}

const BEDROCK_ANTHROPIC =
  /^(?:(?:us|eu|apac|global|jp|au|ca|sa|us-gov)\.)?anthropic\.(claude-[a-z0-9.-]+?)(?:-v\d+(?::\d+)?)?$/i;

export function classifyId(
  id: string,
  guess: ProviderGuess,
  index: RegistryIndex,
  today: string,
  days: number,
): Classification {
  const hit = index.lookup(id);
  if (hit) {
    const info = computeStatus(hit.entry, today, days);
    return {
      matchedKey: hit.matchedKey,
      provider: hit.entry.provider,
      status: info.status,
      daysLeft: info.daysLeft,
      date: info.date,
      replacement: index.resolveReplacement(hit.entry),
      directReplacement: hit.entry.replacement,
      source: hit.entry.source,
      notes: hit.entry.notes || null,
      entry: hit.entry,
    };
  }
  let notes: string | null = null;
  const bedrock = id.match(BEDROCK_ANTHROPIC);
  if (bedrock?.[1]) {
    const firstParty = index.lookup(bedrock[1]);
    if (firstParty) {
      const info = computeStatus(firstParty.entry, today, days);
      const when = info.date ? ` (${info.date})` : "";
      notes = `No Bedrock lifecycle row. The Anthropic first-party entry ${firstParty.entry.id} is ${info.status}${when}. Bedrock sets its own dates.`;
    }
  }
  return {
    matchedKey: null,
    provider: guess,
    status: "unknown",
    daysLeft: null,
    date: null,
    replacement: null,
    directReplacement: null,
    source: null,
    notes,
    entry: null,
  };
}

export function scanText(
  text: string,
  file: string,
  absolutePath: string,
  options: Pick<ScanOptions, "index" | "today" | "days">,
): Finding[] {
  const candidates: Candidate[] = findCandidates(text);
  return candidates.map((c) => ({
    ...classifyId(c.id, c.provider, options.index, options.today, options.days),
    file,
    absolutePath,
    line: c.line,
    column: c.column,
    id: c.id,
    quoted: c.quoted,
  }));
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s !== 0) return s;
    const da = a.daysLeft ?? Number.MAX_SAFE_INTEGER;
    const db = b.daysLeft ?? Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

export function countByStatus(findings: Finding[]): Record<Status, number> {
  const counts: Record<Status, number> = {
    retired: 0,
    retiring: 0,
    deprecated: 0,
    eligible: 0,
    active: 0,
    unknown: 0,
  };
  for (const f of findings) counts[f.status] += 1;
  return counts;
}

export async function scanPath(options: ScanOptions): Promise<ScanResult> {
  const started = performance.now();
  const root = path.resolve(options.root);
  const findings: Finding[] = [];
  let filesScanned = 0;
  for await (const file of walkFiles({
    root,
    respectGitignore: options.respectGitignore ?? true,
    extensions: options.extensions ?? DEFAULT_EXTENSIONS,
  })) {
    const text = await readTextFile(file);
    if (text === null) continue;
    filesScanned += 1;
    const rel = path.relative(root, file).split(path.sep).join("/") || path.basename(file);
    findings.push(...scanText(text, rel, file, options));
  }
  const sorted = sortFindings(findings);
  return {
    root,
    today: options.today,
    days: options.days,
    registryVersion: options.index.registry.version,
    filesScanned,
    durationMs: Math.round(performance.now() - started),
    findings: sorted,
    counts: countByStatus(sorted),
  };
}
