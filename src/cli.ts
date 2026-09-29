import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CHECK_HELP, runCheck } from "./commands/check.js";
import { FIX_HELP, runFix } from "./commands/fix.js";
import { REGISTRY_HELP, runRegistry } from "./commands/registry.js";
import { REPLAY_HELP, runReplayCommand } from "./commands/replay.js";
import { runScan, SCAN_HELP } from "./commands/scan.js";
import { type IO, UsageError } from "./commands/shared.js";
import { ProviderError } from "./providers/types.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

export const VERSION: string = pkg.version;

export const HELP = `modelshift ${VERSION}
Your model changed. Find out what broke before your users do.

Usage: modelshift <command> [options]

Commands:
  scan [path]      Find model IDs in a repo and report retired, retiring, deprecated,
                   eligible, active or unknown status (default command)
  check [path]     scan for CI: exits 1 when a model retires within --days
  replay           Run the same prompts on two models and diff the results
  fix [path]       Rewrite retiring model IDs, strip rejected parameters, print a diff
  registry         List, show, validate or refresh the bundled lifecycle registry

Every command accepts --json and --help. Run "modelshift <command> --help" for options.
`;

const COMMANDS: Record<string, { run: (argv: string[], io: IO) => Promise<number>; help: string }> =
  {
    scan: { run: runScan, help: SCAN_HELP },
    check: { run: runCheck, help: CHECK_HELP },
    replay: { run: runReplayCommand, help: REPLAY_HELP },
    fix: { run: runFix, help: FIX_HELP },
    registry: { run: runRegistry, help: REGISTRY_HELP },
  };

export function defaultIO(): IO {
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    env: process.env,
    cwd: process.cwd(),
    isTTY: Boolean(process.stdout.isTTY),
  };
}

export async function main(argv: string[], io: IO = defaultIO()): Promise<number> {
  const first = argv[0];
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return first === undefined ? 0 : 0;
  }
  if (first === "--version" || first === "-v" || first === "version") {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  let name = first;
  let rest = argv.slice(1);
  if (!COMMANDS[name]) {
    if (first.startsWith("-") || existsSync(path.resolve(io.cwd, first))) {
      name = "scan";
      rest = argv;
    } else {
      io.stderr(`Unknown command "${first}".\n\n${HELP}`);
      return 2;
    }
  }
  const command = COMMANDS[name]!;
  try {
    return await command.run(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`error: ${error.message}\n\n${command.help}`);
      return 2;
    }
    if (error instanceof ProviderError) {
      io.stderr(`error: ${error.message}\n`);
      return 2;
    }
    io.stderr(`error: ${(error as Error).message}\n`);
    return 2;
  }
}
