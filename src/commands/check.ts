import path from "node:path";
import { bold, green, red } from "../output/colors.js";
import { plural, statusLabel } from "../output/format.js";
import type { Status } from "../registry/types.js";
import { type Finding, scanPath } from "../scan/index.js";
import { renderFindings, resultToJson } from "./scan.js";
import {
  COMMON_OPTIONS,
  csv,
  flag,
  type IO,
  int,
  loadIndex,
  parse,
  resolveRoot,
  resolveToday,
  UsageError,
} from "./shared.js";

export const CHECK_HELP = `Usage: modelshift check [path] [options]

Scan for CI. Prints only the findings that fail the policy and exits 1 when there are any.

Options:
  --days <n>          Fail when a model retires within this many days (default 90)
  --fail-on <list>    Comma separated statuses that fail the check
                      (default "retired,retiring", also accepts deprecated, eligible, unknown)
  --annotations       Emit GitHub Actions annotations (default when GITHUB_ACTIONS is set)
  --no-gitignore      Do not honour .gitignore files
  --registry <file>   Use a different lifecycle.json
  --today <date>      Evaluate as of this ISO date
  --json              Print machine readable output
  -h, --help          Show this help
`;

const OPTIONS = {
  ...COMMON_OPTIONS,
  days: { type: "string" as const },
  "fail-on": { type: "string" as const },
  annotations: { type: "boolean" as const },
};

const VALID: Status[] = ["retired", "retiring", "deprecated", "eligible", "active", "unknown"];

function annotation(f: Finding): string {
  const message = `${f.id} is ${statusLabel(f)}${f.replacement ? `, replace with ${f.replacement}` : ""}${f.source ? ` (${f.source})` : ""}`;
  const level = f.status === "retired" || f.status === "retiring" ? "error" : "warning";
  return `::${level} file=${f.file},line=${f.line},col=${f.column},title=modelshift::${message}\n`;
}

export async function runCheck(argv: string[], io: IO): Promise<number> {
  const { values, positionals } = parse(argv, OPTIONS);
  if (flag(values, "help")) {
    io.stdout(CHECK_HELP);
    return 0;
  }
  const root = resolveRoot(positionals, io);
  const days = int(values, "days", 90);
  const today = resolveToday(values);
  const failOn = csv(values, "fail-on", ["retired", "retiring"]);
  for (const s of failOn) {
    if (!VALID.includes(s as Status))
      throw new UsageError(`--fail-on contains unknown status "${s}"`);
  }
  const index = loadIndex(values, io);
  const result = await scanPath({
    root,
    days,
    today,
    index,
    respectGitignore: !flag(values, "no-gitignore"),
  });
  const failing = result.findings.filter((f) => failOn.includes(f.status));
  const annotate =
    flag(values, "annotations") ||
    (values.annotations === undefined && Boolean(io.env.GITHUB_ACTIONS));
  if (flag(values, "json")) {
    io.stdout(
      `${JSON.stringify({ ...resultToJson(result, failing), failOn, ok: failing.length === 0 }, null, 2)}\n`,
    );
    if (annotate) for (const f of failing) io.stderr(annotation(f));
    return failing.length === 0 ? 0 : 1;
  }
  const rel = path.relative(io.cwd, root) || ".";
  if (failing.length === 0) {
    io.stdout(
      `${green("OK")} modelshift check ${rel}: no model with status ${failOn.join(" or ")} within ${days} days (${plural(result.filesScanned, "file")} scanned, registry ${result.registryVersion}).\n`,
    );
    return 0;
  }
  io.stdout(
    `${bold(red("FAIL"))} modelshift check ${rel}: ${plural(failing.length, "model identifier")} with status ${failOn.join(" or ")} within ${days} days.\n\n`,
  );
  io.stdout(`${renderFindings(failing)}\n`);
  if (annotate) for (const f of failing) io.stdout(annotation(f));
  io.stdout(`\nRun "npx modelshift fix ${rel}" to see the migration diff.\n`);
  return 1;
}
