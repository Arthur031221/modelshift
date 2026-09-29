import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { daysBetween, isISODate } from "../util/dates.js";
import type { LifecycleEntry, Registry, StatusInfo } from "./types.js";

export type { LifecycleEntry, Registry, Status, StatusInfo } from "./types.js";
export { STATUS_ORDER } from "./types.js";

/** Resolves a file under the package's registry/ directory from both dist/ and src/. */
export function packageRegistryFile(name: string): string {
  const candidates = [`../registry/${name}`, `../../registry/${name}`];
  for (const rel of candidates) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(file)) return file;
  }
  return fileURLToPath(new URL(candidates[0]!, import.meta.url));
}

export function defaultRegistryPath(): string {
  return packageRegistryFile("lifecycle.json");
}

export function loadRegistry(file?: string): Registry {
  const target = file ?? defaultRegistryPath();
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (error) {
    throw new Error(`Cannot read registry at ${target}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Registry at ${target} is not valid JSON: ${(error as Error).message}`);
  }
  const problems = validateRegistry(parsed);
  if (problems.length > 0) {
    throw new Error(`Registry at ${target} is invalid:\n  ${problems.join("\n  ")}`);
  }
  return parsed as Registry;
}

export function validateRegistry(value: unknown): string[] {
  const problems: string[] = [];
  if (!value || typeof value !== "object") return ["registry must be an object"];
  const reg = value as Partial<Registry>;
  if (typeof reg.version !== "string") problems.push("version must be a string");
  if (!isISODate(reg.generated)) problems.push("generated must be an ISO date");
  if (!Array.isArray(reg.models)) return [...problems, "models must be an array"];
  const seen = new Map<string, string>();
  reg.models.forEach((entry, index) => {
    const where = `models[${index}]${entry && typeof entry === "object" && "id" in entry ? ` (${String((entry as LifecycleEntry).id)})` : ""}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${where}: must be an object`);
      return;
    }
    const e = entry as Partial<LifecycleEntry>;
    if (typeof e.id !== "string" || e.id.length === 0) problems.push(`${where}: id is required`);
    if (typeof e.provider !== "string" || e.provider.length === 0)
      problems.push(`${where}: provider is required`);
    if (!Array.isArray(e.aliases) || e.aliases.some((a) => typeof a !== "string"))
      problems.push(`${where}: aliases must be an array of strings`);
    for (const field of ["announced", "deprecated", "retirement", "retirement_earliest"] as const) {
      const v = e[field];
      if (v !== undefined && v !== null && !isISODate(v))
        problems.push(`${where}: ${field} must be an ISO date or null`);
    }
    if (e.deprecated && e.retirement && isISODate(e.deprecated) && isISODate(e.retirement)) {
      if (daysBetween(e.deprecated, e.retirement) < 0)
        problems.push(`${where}: deprecated date is after retirement date`);
    }
    if (e.replacement !== null && typeof e.replacement !== "string")
      problems.push(`${where}: replacement must be a string or null`);
    if (typeof e.notes !== "string") problems.push(`${where}: notes must be a string`);
    if (typeof e.source !== "string" || !/^https:\/\//.test(e.source))
      problems.push(`${where}: source must be an https URL`);
    const keys = [e.id, ...(Array.isArray(e.aliases) ? e.aliases : [])].filter(
      (k): k is string => typeof k === "string",
    );
    for (const key of keys) {
      const lower = key.toLowerCase();
      const owner = seen.get(lower);
      if (owner && owner !== e.id) problems.push(`${where}: "${key}" is already used by ${owner}`);
      else seen.set(lower, e.id ?? "?");
    }
  });
  return problems;
}

export function computeStatus(
  entry: LifecycleEntry,
  today: string,
  windowDays: number,
): StatusInfo {
  if (entry.retirement) {
    const d = daysBetween(today, entry.retirement);
    if (d <= 0) return { status: "retired", daysLeft: d, date: entry.retirement };
    if (d <= windowDays) return { status: "retiring", daysLeft: d, date: entry.retirement };
    return { status: "deprecated", daysLeft: d, date: entry.retirement };
  }
  if (entry.deprecated) {
    return { status: "deprecated", daysLeft: null, date: entry.deprecated };
  }
  if (entry.retirement_earliest) {
    const d = daysBetween(today, entry.retirement_earliest);
    if (d <= windowDays)
      return { status: "eligible", daysLeft: d, date: entry.retirement_earliest };
    return { status: "active", daysLeft: d, date: entry.retirement_earliest };
  }
  return { status: "active", daysLeft: null, date: null };
}

const VENDOR_PREFIXES = [
  "openai/",
  "anthropic/",
  "google/",
  "gemini/",
  "vertex_ai/",
  "vertex/",
  "bedrock/",
  "azure/",
  "openrouter/",
  "models/",
];
const REGION_PREFIX = /^(?:us|eu|apac|global|jp|au|ca|sa|us-gov)\./;

/** Candidate spellings to try when resolving a raw identifier, most specific first. */
export function normalizeCandidates(raw: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    if (s && !out.includes(s)) out.push(s);
  };
  push(raw);
  push(raw.toLowerCase());
  let stripped = raw;
  for (const prefix of VENDOR_PREFIXES) {
    if (stripped.toLowerCase().startsWith(prefix)) {
      stripped = stripped.slice(prefix.length);
      break;
    }
  }
  push(stripped);
  push(stripped.toLowerCase());
  if (REGION_PREFIX.test(stripped)) {
    const noRegion = stripped.replace(REGION_PREFIX, "");
    push(noRegion);
    push(noRegion.toLowerCase());
  }
  return out;
}

export interface Lookup {
  entry: LifecycleEntry;
  /** The registry key that matched: the id itself or one of its aliases. */
  matchedKey: string;
  viaAlias: boolean;
}

export class RegistryIndex {
  private readonly byKey = new Map<
    string,
    { entry: LifecycleEntry; alias: boolean; key: string }
  >();

  constructor(public readonly registry: Registry) {
    for (const entry of registry.models) {
      this.byKey.set(entry.id.toLowerCase(), { entry, alias: false, key: entry.id });
      for (const alias of entry.aliases) {
        if (!this.byKey.has(alias.toLowerCase()))
          this.byKey.set(alias.toLowerCase(), { entry, alias: true, key: alias });
      }
    }
  }

  lookup(raw: string): Lookup | undefined {
    for (const candidate of normalizeCandidates(raw)) {
      const hit = this.byKey.get(candidate.toLowerCase());
      if (hit) return { entry: hit.entry, matchedKey: hit.key, viaAlias: hit.alias };
    }
    return undefined;
  }

  get(id: string): LifecycleEntry | undefined {
    return this.byKey.get(id.toLowerCase())?.entry;
  }

  /**
   * Follows replacement pointers while the pointed-at model itself has a scheduled
   * retirement and names a successor. Stops at the first model without a retirement
   * date, at an unknown identifier, or after `maxHops`.
   */
  resolveReplacement(entry: LifecycleEntry, maxHops = 6): string | null {
    let target: string | null = entry.replacement;
    const seen = new Set<string>([entry.id.toLowerCase()]);
    for (let hop = 0; hop < maxHops && target; hop += 1) {
      if (seen.has(target.toLowerCase())) return target;
      seen.add(target.toLowerCase());
      const next: Lookup | undefined = this.lookup(target);
      if (!next) return target;
      const candidate = next.entry;
      if (!candidate.retirement || !candidate.replacement) return target;
      target = candidate.replacement;
    }
    return target;
  }

  entries(): LifecycleEntry[] {
    return this.registry.models;
  }
}
