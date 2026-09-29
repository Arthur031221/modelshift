import { existsSync } from "node:fs";
import path from "node:path";
import { type ParseArgsConfig, parseArgs } from "node:util";
import { loadRegistry, RegistryIndex } from "../registry/index.js";
import { isISODate, todayISO } from "../util/dates.js";

export interface IO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  isTTY: boolean;
  fetchImpl?: typeof fetch;
  /** Answers interactive confirmations. Defaults to reading stdin. */
  confirm?: (question: string) => Promise<boolean>;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export type OptionSpec = NonNullable<ParseArgsConfig["options"]>;
export type Values = Record<string, string | boolean | Array<string | boolean> | undefined>;

export const COMMON_OPTIONS: OptionSpec = {
  json: { type: "boolean" },
  registry: { type: "string" },
  today: { type: "string" },
  "no-gitignore": { type: "boolean" },
  help: { type: "boolean", short: "h" },
};

export function parse(
  argv: string[],
  options: OptionSpec,
): { values: Values; positionals: string[] } {
  try {
    const result = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    return { values: result.values as Values, positionals: result.positionals };
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

export function str(values: Values, name: string): string | undefined {
  const v = values[name];
  return typeof v === "string" ? v : undefined;
}

export function flag(values: Values, name: string): boolean {
  return values[name] === true;
}

export function int(values: Values, name: string, fallback: number, min = 0): number {
  const raw = str(values, name);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min)
    throw new UsageError(`--${name} must be an integer >= ${min}, received "${raw}"`);
  return n;
}

export function resolveToday(values: Values): string {
  const raw = str(values, "today");
  if (raw === undefined) return todayISO();
  if (!isISODate(raw))
    throw new UsageError(`--today must be an ISO date (YYYY-MM-DD), received "${raw}"`);
  return raw;
}

export function loadIndex(values: Values, io: IO): RegistryIndex {
  const custom = str(values, "registry");
  const file = custom ? path.resolve(io.cwd, custom) : undefined;
  return new RegistryIndex(loadRegistry(file));
}

export function resolveRoot(positionals: string[], io: IO): string {
  const target = positionals[0] ?? ".";
  const root = path.resolve(io.cwd, target);
  if (!existsSync(root)) throw new UsageError(`Path does not exist: ${target}`);
  return root;
}

export function csv(values: Values, name: string, fallback: string[]): string[] {
  const raw = str(values, name);
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
