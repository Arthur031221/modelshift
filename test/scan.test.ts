import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import type { IO } from "../src/commands/shared.js";
import { loadRegistry, RegistryIndex } from "../src/registry/index.js";
import { scanPath, scanText } from "../src/scan/index.js";
import { findCandidatesInLine } from "../src/scan/matcher.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sample = path.join(root, "examples", "sample-app");
const index = new RegistryIndex(loadRegistry());
const TODAY = "2026-09-30";

function fakeIO(): IO & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env: {},
    cwd: root,
    isTTY: false,
  };
}

describe("matcher", () => {
  it("finds strongly prefixed ids anywhere and short ids only when quoted", () => {
    expect(findCandidatesInLine('model = "gpt-4o-2024-05-13"', 1).map((c) => c.id)).toEqual([
      "gpt-4o-2024-05-13",
    ]);
    expect(findCandidatesInLine("fallback: claude-3-haiku-20240307", 1).map((c) => c.id)).toEqual([
      "claude-3-haiku-20240307",
    ]);
    expect(findCandidatesInLine('reasoning: "o3-mini",', 1).map((c) => c.id)).toEqual(["o3-mini"]);
    expect(findCandidatesInLine("const o1 = 5", 1)).toEqual([]);
    expect(findCandidatesInLine('const local = "qwen3:4b"', 1).map((c) => c.provider)).toEqual([
      "ollama",
    ]);
  });

  it("skips URLs, product names and ignored lines", () => {
    expect(findCandidatesInLine("see https://platform.openai.com/docs/models/gpt-4", 1)).toEqual(
      [],
    );
    expect(findCandidatesInLine("npm install claude-code gemini-cli", 1)).toEqual([]);
    expect(findCandidatesInLine('model: "gpt-4" # modelshift:ignore', 1)).toEqual([]);
  });

  it("handles Bedrock and Vertex spellings", () => {
    const ids = findCandidatesInLine(
      '"us.anthropic.claude-sonnet-4-20250514-v1:0" claude-haiku-4-5@20251001',
      1,
    ).map((c) => c.id);
    expect(ids).toEqual([
      "us.anthropic.claude-sonnet-4-20250514-v1:0",
      "claude-haiku-4-5@20251001",
    ]);
  });
});

describe("scan", () => {
  it("classifies the sample app", async () => {
    const result = await scanPath({ root: sample, days: 90, today: TODAY, index });
    const byId = new Map(result.findings.map((f) => [f.id, f]));
    expect(byId.get("gpt-4o-2024-05-13")?.status).toBe("retiring");
    expect(byId.get("gpt-4o-2024-05-13")?.replacement).toBe("gpt-5.6-sol");
    expect(byId.get("claude-3-5-sonnet-20241022")?.status).toBe("retired");
    expect(byId.get("claude-sonnet-4-5")?.status).toBe("eligible");
    expect(byId.get("gpt-5.6-sol")?.status).toBe("active");
    expect(byId.get("anthropic.claude-sonnet-4-20250514-v1:0")?.status).toBe("retiring");
    expect(byId.get("qwen3:4b")?.status).toBe("unknown");
    expect(result.counts.retiring).toBeGreaterThanOrEqual(5);
    expect(result.findings[0]!.status).toBe("retired");
  });

  it("explains unknown Bedrock ids through the first-party entry", () => {
    const findings = scanText(
      'modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0"',
      "x.yaml",
      "/x.yaml",
      { index, today: TODAY, days: 90 },
    );
    expect(findings[0]!.status).toBe("unknown");
    expect(findings[0]!.notes).toContain("claude-3-5-sonnet-20241022 is retired");
  });

  it("returns exit code 1 and JSON through the CLI", async () => {
    const io = fakeIO();
    const code = await main(["scan", "examples/sample-app", "--json", "--today", TODAY], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.out.join(""));
    expect(parsed.counts.retiring).toBeGreaterThan(0);
    expect(parsed.findings[0].source).toMatch(/^https/);
  });

  it("handles an empty directory", async () => {
    const { mkdtempSync } = await import("node:fs");
    const os = await import("node:os");
    const dir = mkdtempSync(path.join(os.tmpdir(), "modelshift-empty-"));
    const io = fakeIO();
    const code = await main(["scan", dir], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("no model identifiers found");
  });

  it("check fails on retiring models and honours --fail-on", async () => {
    const io = fakeIO();
    expect(await main(["check", "examples/sample-app", "--today", TODAY], io)).toBe(1);
    expect(io.out.join("")).toContain("FAIL");
    const io2 = fakeIO();
    expect(
      await main(
        ["check", "examples/sample-app", "--today", TODAY, "--fail-on", "unknown", "--days", "0"],
        io2,
      ),
    ).toBe(1);
    const io3 = fakeIO();
    expect(
      await main(["check", "examples/sample-app", "--today", "2020-01-01", "--days", "1"], io3),
    ).toBe(0);
  });
});
