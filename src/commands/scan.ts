import path from "node:path";
import { bold, dim } from "../output/colors.js";
import { colorStatus, plural, shortUrl, statusLabel } from "../output/format.js";
import { renderTable } from "../output/table.js";
import { type Finding, type ScanResult, scanPath } from "../scan/index.js";
import {
  COMMON_OPTIONS,
  flag,
  type IO,
  int,
  loadIndex,
  parse,
  resolveRoot,
  resolveToday,
  type Values,
} from "./shared.js";

export const SCAN_HELP = `Usage: modelshift scan [path] [options]

Walks the repository, finds model identifiers and reports their lifecycle status.

Options:
  --days <n>        Window for "retiring" in days (default 90)
  --known-only      Hide identifiers that are not in the registry
  --no-gitignore    Do not honour .gitignore files
  --registry <file> Use a different lifecycle.json
  --today <date>    Evaluate as of this ISO date (default: today)
  --json            Print machine readable output
  -h, --help        Show this help

Exit codes: 0 nothing retires within the window, 1 something is retired or retiring, 2 usage error.
`;

const OPTIONS = {
  ...COMMON_OPTIONS,
  days: { type: "string" as const },
  "known-only": { type: "boolean" as const },
};

export function findingToJson(f: Finding): Record<string, unknown> {
  return {
    file: f.file,
    line: f.line,
    column: f.column,
    id: f.id,
    matchedKey: f.matchedKey,
    provider: f.provider,
    status: f.status,
    daysLeft: f.daysLeft,
    date: f.date,
    replacement: f.replacement,
    directReplacement: f.directReplacement,
    source: f.source,
    notes: f.notes,
  };
}

export function resultToJson(result: ScanResult, findings: Finding[]): Record<string, unknown> {
  return {
    root: result.root,
    today: result.today,
    days: result.days,
    registryVersion: result.registryVersion,
    filesScanned: result.filesScanned,
    durationMs: result.durationMs,
    counts: result.counts,
    findings: findings.map(findingToJson),
  };
}

export function summaryLine(result: ScanResult): string {
  const c = result.counts;
  const parts: string[] = [];
  if (c.retiring) parts.push(`${c.retiring} retiring within ${result.days} days`);
  if (c.retired) parts.push(`${c.retired} retired`);
  if (c.deprecated) parts.push(`${c.deprecated} deprecated`);
  if (c.eligible) parts.push(`${c.eligible} eligible for retirement`);
  if (c.active) parts.push(`${c.active} active`);
  if (c.unknown) parts.push(`${c.unknown} unknown`);
  const head = parts.length ? parts.join(", ") : "no model identifiers found";
  return `${head}. ${plural(result.filesScanned, "file")} scanned in ${result.durationMs} ms.`;
}

export function renderFindings(findings: Finding[]): string {
  return renderTable(
    [
      { key: "file", header: "FILE", maxWidth: 48, keepTail: true },
      { key: "model", header: "MODEL", maxWidth: 44 },
      { key: "provider", header: "PROVIDER" },
      { key: "status", header: "STATUS" },
      { key: "replacement", header: "REPLACEMENT", maxWidth: 36 },
      { key: "source", header: "SOURCE", maxWidth: 60 },
    ],
    findings.map((f) => ({
      file: `${f.file}:${f.line}`,
      model: f.id,
      provider: f.provider,
      status: colorStatus(f.status, statusLabel(f)),
      replacement: f.replacement ?? (f.status === "unknown" || f.status === "active" ? "" : "-"),
      source: shortUrl(f.source),
    })),
  );
}

export async function runScan(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parse(argv, OPTIONS);
  if (flag(values, "help")) {
    io.stdout(SCAN_HELP);
    return 0;
  }
  const root = resolveRoot(positionals, io);
  const days = int(values, "days", 90);
  const today = resolveToday(values);
  const index = loadIndex(values, io);
  const result = await scanPath({
    root,
    days,
    today,
    index,
    respectGitignore: !flag(values, "no-gitignore"),
  });
  const shown = flag(values, "known-only")
    ? result.findings.filter((f) => f.status !== "unknown")
    : result.findings;
  const failing = result.counts.retired + result.counts.retiring > 0;
  if (flag(values, "json")) {
    io.stdout(`${JSON.stringify(resultToJson(result, shown), null, 2)}\n`);
    return failing ? 1 : 0;
  }
  const rel = path.relative(io.cwd, root) || ".";
  io.stdout(
    `${bold("modelshift scan")} ${rel} ${dim(`(registry ${result.registryVersion}, today ${today}, window ${days} days)`)}\n\n`,
  );
  if (shown.length === 0) {
    io.stdout(`${summaryLine(result)}\n`);
    return failing ? 1 : 0;
  }
  io.stdout(`${renderFindings(shown)}\n\n${summaryLine(result)}\n`);
  const notes = shown.filter((f) => f.status === "unknown" && f.notes);
  for (const f of notes) io.stdout(dim(`note: ${f.file}:${f.line} ${f.id}: ${f.notes}\n`));
  return failing ? 1 : 0;
}

export type { Values };
