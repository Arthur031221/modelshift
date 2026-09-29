import { promises as fs } from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";

export const DEFAULT_EXTENSIONS: ReadonlySet<string> = new Set([
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".kts",
  ".cs",
  ".yaml",
  ".yml",
  ".toml",
  ".json",
  ".env",
  ".md",
  ".txt",
]);

const ALWAYS_SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "env",
  "__pycache__",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  "coverage",
  ".cache",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "vendor",
  ".idea",
  ".vscode",
  ".terraform",
  "site-packages",
]);

const SKIP_FILES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "uv.lock",
  "Cargo.lock",
  "go.sum",
  "composer.lock",
  "Gemfile.lock",
]);

export interface WalkOptions {
  root: string;
  extensions?: ReadonlySet<string>;
  respectGitignore?: boolean;
  maxBytes?: number;
}

interface Ignorer {
  base: string;
  ig: Ignore;
}

export function isScannableName(name: string, extensions: ReadonlySet<string>): boolean {
  if (SKIP_FILES.has(name)) return false;
  if (name === ".env" || name.startsWith(".env.")) return extensions.has(".env");
  const ext = path.extname(name).toLowerCase();
  return ext.length > 0 && extensions.has(ext);
}

async function loadIgnorer(dir: string): Promise<Ignorer | null> {
  try {
    const content = await fs.readFile(path.join(dir, ".gitignore"), "utf8");
    return { base: dir, ig: ignore().add(content) };
  } catch {
    return null;
  }
}

function isIgnored(ignorers: Ignorer[], fullPath: string, isDir: boolean): boolean {
  for (const { base, ig } of ignorers) {
    const rel = path.relative(base, fullPath).split(path.sep).join("/");
    if (!rel || rel.startsWith("..")) continue;
    if (ig.ignores(isDir ? `${rel}/` : rel)) return true;
  }
  return false;
}

/** Yields absolute paths of files worth scanning, honouring .gitignore files at every level. */
export async function* walkFiles(options: WalkOptions): AsyncGenerator<string> {
  const root = path.resolve(options.root);
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const respect = options.respectGitignore ?? true;
  const rootStat = await fs.stat(root);
  if (rootStat.isFile()) {
    yield root;
    return;
  }
  const stack: Array<{ dir: string; ignorers: Ignorer[] }> = [{ dir: root, ignorers: [] }];
  while (stack.length > 0) {
    const { dir, ignorers } = stack.pop()!;
    let scoped = ignorers;
    if (respect) {
      const local = await loadIgnorer(dir);
      if (local) scoped = [...ignorers, local];
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
        if (respect && isIgnored(scoped, full, true)) continue;
        stack.push({ dir: full, ignorers: scoped });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isScannableName(entry.name, extensions)) continue;
      if (respect && isIgnored(scoped, full, false)) continue;
      yield full;
    }
  }
}

/** Reads a file as UTF-8 text. Returns null for binary or oversized files. */
export async function readTextFile(
  file: string,
  maxBytes = 2 * 1024 * 1024,
): Promise<string | null> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (stat.size > maxBytes) return null;
  const buf = await fs.readFile(file);
  const probe = buf.subarray(0, Math.min(buf.length, 8000));
  if (probe.includes(0)) return null;
  return buf.toString("utf8");
}
