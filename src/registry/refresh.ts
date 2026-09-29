import { isISODate, parseLooseDate } from "../util/dates.js";
import type { LifecycleEntry, Registry } from "./types.js";

/**
 * Best-effort refresh of the lifecycle registry from the provider pages.
 * Parsers are deliberately tolerant. When a page cannot be parsed the existing
 * entries are kept and the failure is reported.
 */

export const REFRESH_SOURCES = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/model-deprecations.md",
  openai: "https://developers.openai.com/api/docs/deprecations",
  google: "https://ai.google.dev/gemini-api/docs/deprecations",
  bedrock: "https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle-legacy.html",
};

export type Partial = Pick<LifecycleEntry, "id" | "provider" | "source"> &
  globalThis.Partial<
    Pick<
      LifecycleEntry,
      "announced" | "deprecated" | "retirement" | "retirement_earliest" | "replacement"
    >
  >;

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)));
}

export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Extracts every table as rows of cell text. */
export function extractTables(html: string): Array<{ index: number; rows: string[][] }> {
  const tables: Array<{ index: number; rows: string[][] }> = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let match: RegExpExecArray | null = tableRe.exec(html);
  while (match) {
    const rows: string[][] = [];
    for (const rowHtml of match[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
        stripTags(m[1]!),
      );
      if (cells.length) rows.push(cells);
    }
    tables.push({ index: match.index, rows });
    match = tableRe.exec(html);
  }
  return tables;
}

function headingDates(html: string): Array<{ index: number; date: string }> {
  const out: Array<{ index: number; date: string }> = [];
  const re = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi;
  let match: RegExpExecArray | null = re.exec(html);
  while (match) {
    const text = stripTags(match[1]!);
    const iso = text.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? parseLooseDate(text.replace(/:.*$/, ""));
    if (iso && isISODate(iso)) out.push({ index: match.index, date: iso });
    match = re.exec(html);
  }
  return out;
}

function columnIndex(header: string[], patterns: RegExp[]): number {
  for (const re of patterns) {
    const i = header.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

function cleanId(raw: string): string {
  return raw.replace(/[`*]/g, "").trim();
}

export function parseAnthropicMarkdown(md: string): Partial[] {
  const out: Partial[] = [];
  const source = "https://platform.claude.com/docs/en/about-claude/model-deprecations";
  const statusRow =
    /^\|\s*(claude-[\w.-]+)\s*\|\s*([A-Za-z]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/;
  const historyRow = /^\|\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/;
  let sectionDate: string | null = null;
  for (const line of md.split("\n")) {
    const heading = line.match(/^###\s+(\d{4}-\d{2}-\d{2}):/);
    if (heading) {
      sectionDate = heading[1]!;
      continue;
    }
    const status = line.match(statusRow);
    if (status) {
      const [, id, , deprecatedRaw, retirementRaw] = status;
      const entry: Partial = { id: id!, provider: "anthropic", source };
      const deprecated = parseLooseDate(deprecatedRaw!);
      if (deprecated) entry.deprecated = deprecated;
      const notSooner = retirementRaw!.match(/not sooner than\s+(.+)$/i);
      if (notSooner) {
        const d = parseLooseDate(notSooner[1]!);
        if (d) entry.retirement_earliest = d;
      } else {
        const d = parseLooseDate(retirementRaw!);
        if (d) entry.retirement = d;
      }
      out.push(entry);
      continue;
    }
    const history = line.match(historyRow);
    if (history && sectionDate) {
      const [, dateRaw, id, replacement] = history;
      const retirement = parseLooseDate(dateRaw!);
      out.push({
        id: cleanId(id!),
        provider: "anthropic",
        source,
        announced: sectionDate,
        deprecated: sectionDate,
        retirement: retirement ?? undefined,
        replacement: cleanId(replacement!),
      });
    }
  }
  return out;
}

export function parseOpenAIHtml(html: string): Partial[] {
  const out: Partial[] = [];
  const source = REFRESH_SOURCES.openai;
  const headings = headingDates(html);
  for (const table of extractTables(html)) {
    const header = table.rows[0] ?? [];
    const shutdownCol = columnIndex(header, [/shutdown/i]);
    const modelCol = columnIndex(header, [/model|snapshot|system/i]);
    const replacementCol = columnIndex(header, [/replacement|substitute/i]);
    if (shutdownCol < 0 || modelCol < 0 || shutdownCol === modelCol) continue;
    const section = [...headings].reverse().find((h) => h.index < table.index);
    for (const row of table.rows.slice(1)) {
      const shutdown = parseLooseDate(row[shutdownCol] ?? "");
      if (!shutdown) continue;
      const ids = (row[modelCol] ?? "")
        .split(/[\n,]/)
        .map(cleanId)
        .filter((id) => /^[a-z0-9][\w.:-]*$/i.test(id) && !/^ft-/.test(id));
      const replacement =
        replacementCol >= 0 ? cleanId((row[replacementCol] ?? "").split(/[\n,]/)[0] ?? "") : "";
      for (const id of ids) {
        out.push({
          id,
          provider: "openai",
          source,
          announced: section?.date,
          deprecated: section?.date,
          retirement: shutdown,
          replacement: replacement || undefined,
        });
      }
    }
  }
  return out;
}

export function parseGeminiHtml(html: string): Partial[] {
  const out: Partial[] = [];
  for (const table of extractTables(html)) {
    const header = table.rows[0] ?? [];
    const modelCol = columnIndex(header, [/model/i]);
    const shutdownCol = columnIndex(header, [/shutdown/i]);
    const replacementCol = columnIndex(header, [/replacement/i]);
    if (modelCol < 0 || shutdownCol < 0) continue;
    for (const row of table.rows.slice(1)) {
      const id = cleanId((row[modelCol] ?? "").split("\n")[0] ?? "");
      if (!/^[a-z0-9][\w.-]*$/i.test(id)) continue;
      const shutdown = parseLooseDate(row[shutdownCol] ?? "");
      const replacement =
        replacementCol >= 0 ? cleanId((row[replacementCol] ?? "").split("\n")[0] ?? "") : "";
      const entry: Partial = { id, provider: "google", source: REFRESH_SOURCES.google };
      if (shutdown) entry.retirement = shutdown;
      if (replacement && /^[a-z0-9][\w.-]*$/i.test(replacement)) entry.replacement = replacement;
      out.push(entry);
    }
  }
  return out;
}

export function parseBedrockHtml(html: string): Partial[] {
  const out: Partial[] = [];
  for (const table of extractTables(html)) {
    const header = table.rows[0] ?? [];
    const idCol = columnIndex(header, [/model id/i]);
    const legacyCol = columnIndex(header, [/legacy date/i]);
    const eolCol = columnIndex(header, [/eol/i]);
    if (idCol < 0 || eolCol < 0) continue;
    for (const row of table.rows.slice(1)) {
      const id = cleanId(row[idCol] ?? "");
      if (!/^[a-z0-9]+\.[\w.:-]+$/i.test(id)) continue;
      const eol = parseLooseDate(row[eolCol] ?? "");
      const legacy = legacyCol >= 0 ? parseLooseDate(row[legacyCol] ?? "") : null;
      const entry: Partial = { id, provider: "bedrock", source: REFRESH_SOURCES.bedrock };
      if (eol) entry.retirement = eol;
      if (legacy) {
        entry.deprecated = legacy;
        entry.announced = legacy;
      }
      out.push(entry);
    }
  }
  return out;
}

export interface RefreshResult {
  registry: Registry;
  fetched: Record<string, { ok: boolean; parsed: number; error?: string }>;
  added: string[];
  updated: string[];
}

const UPDATABLE = [
  "announced",
  "deprecated",
  "retirement",
  "retirement_earliest",
  "replacement",
] as const;

export function mergeRegistry(
  existing: Registry,
  fetched: Partial[],
  today: string,
): { registry: Registry; added: string[]; updated: string[] } {
  const models = existing.models.map((m) => ({ ...m, aliases: [...m.aliases] }));
  const byKey = new Map<string, LifecycleEntry>();
  for (const m of models) {
    byKey.set(m.id.toLowerCase(), m);
    for (const a of m.aliases) byKey.set(a.toLowerCase(), m);
  }
  const added: string[] = [];
  const updated: string[] = [];
  for (const p of fetched) {
    const current = byKey.get(p.id.toLowerCase());
    if (current) {
      for (const field of UPDATABLE) {
        const value = p[field];
        if (value === undefined || value === null) continue;
        if (current[field] !== value) {
          updated.push(`${current.id}: ${field} ${current[field] ?? "null"} -> ${value}`);
          (current as unknown as Record<string, unknown>)[field] = value;
        }
      }
      continue;
    }
    const entry: LifecycleEntry = {
      id: p.id,
      provider: p.provider,
      aliases: [],
      announced: p.announced ?? null,
      deprecated: p.deprecated ?? null,
      retirement: p.retirement ?? null,
      replacement: p.replacement ?? null,
      notes: `Added by registry refresh on ${today}. Verify against the source page.`,
      source: p.source,
    };
    if (p.retirement_earliest) entry.retirement_earliest = p.retirement_earliest;
    models.push(entry);
    byKey.set(entry.id.toLowerCase(), entry);
    added.push(entry.id);
  }
  const changed = added.length > 0 || updated.length > 0;
  return {
    registry: {
      ...existing,
      version: changed ? today : existing.version,
      generated: changed ? today : existing.generated,
      models,
    },
    added,
    updated,
  };
}

export async function refreshRegistry(
  existing: Registry,
  today: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RefreshResult> {
  const fetched: RefreshResult["fetched"] = {};
  const partials: Partial[] = [];
  const jobs: Array<[string, string, (text: string) => Partial[]]> = [
    ["anthropic", REFRESH_SOURCES.anthropic, parseAnthropicMarkdown],
    ["openai", REFRESH_SOURCES.openai, parseOpenAIHtml],
    ["google", REFRESH_SOURCES.google, parseGeminiHtml],
    ["bedrock", REFRESH_SOURCES.bedrock, parseBedrockHtml],
  ];
  for (const [name, url, parser] of jobs) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "modelshift-registry-refresh" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parser(await response.text());
      fetched[name] = { ok: true, parsed: parsed.length };
      partials.push(...parsed);
    } catch (error) {
      fetched[name] = { ok: false, parsed: 0, error: (error as Error).message };
    }
  }
  const merged = mergeRegistry(existing, partials, today);
  return { registry: merged.registry, fetched, added: merged.added, updated: merged.updated };
}
