import { describe, expect, it } from "vitest";
import {
  computeStatus,
  loadRegistry,
  normalizeCandidates,
  RegistryIndex,
  validateRegistry,
} from "../src/registry/index.js";

const registry = loadRegistry();
const index = new RegistryIndex(registry);
const TODAY = "2026-09-30";

describe("bundled registry", () => {
  it("validates with no problems", () => {
    expect(validateRegistry(registry)).toEqual([]);
  });

  it("has a source URL on every entry", () => {
    for (const entry of registry.models) expect(entry.source).toMatch(/^https:\/\//);
  });

  it("classifies the 2026-10-23 OpenAI batch as retiring within 90 days", () => {
    const entry = index.get("gpt-4o-2024-05-13")!;
    const info = computeStatus(entry, TODAY, 90);
    expect(info.status).toBe("retiring");
    expect(info.daysLeft).toBe(23);
    expect(info.date).toBe("2026-10-23");
  });

  it("marks Sonnet 4.5 as eligible for retirement", () => {
    const hit = index.lookup("claude-sonnet-4-5")!;
    expect(hit.viaAlias).toBe(true);
    expect(hit.entry.id).toBe("claude-sonnet-4-5-20250929");
    expect(computeStatus(hit.entry, TODAY, 90).status).toBe("eligible");
  });

  it("marks retired models as retired and active models as active", () => {
    expect(computeStatus(index.get("claude-3-5-sonnet-20241022")!, TODAY, 90).status).toBe(
      "retired",
    );
    expect(computeStatus(index.get("gpt-5.6-sol")!, TODAY, 90).status).toBe("active");
    expect(computeStatus(index.get("claude-opus-4-6")!, TODAY, 90).status).toBe("active");
    expect(computeStatus(index.get("gpt-realtime")!, TODAY, 90).status).toBe("deprecated");
  });

  it("resolves vendor prefixes and Bedrock region prefixes", () => {
    expect(normalizeCandidates("openai/gpt-4")).toContain("gpt-4");
    expect(index.lookup("openai/gpt-4")?.entry.id).toBe("gpt-4-0613");
    expect(index.lookup("us.anthropic.claude-sonnet-4-20250514-v1:0")?.entry.provider).toBe(
      "bedrock",
    );
    expect(index.lookup("models/gemini-2.0-flash")?.entry.id).toBe("gemini-2.0-flash");
  });

  it("follows replacement chains through retired successors", () => {
    expect(index.resolveReplacement(index.get("chatgpt-4o-latest")!)).toBe("gpt-5.6-sol");
    expect(index.resolveReplacement(index.get("o1-mini")!)).toBe("gpt-5.6-terra");
    expect(index.resolveReplacement(index.get("gpt-4o-2024-05-13")!)).toBe("gpt-5.6-sol");
  });

  it("rejects malformed registries", () => {
    const problems = validateRegistry({
      version: "x",
      generated: "2026-09-29",
      sources: {},
      models: [
        {
          id: "a",
          provider: "p",
          aliases: [],
          announced: null,
          deprecated: "2026-12-01",
          retirement: "2026-01-01",
          replacement: null,
          notes: "",
          source: "http://insecure",
        },
      ],
    });
    expect(problems.some((p) => p.includes("after retirement"))).toBe(true);
    expect(problems.some((p) => p.includes("https"))).toBe(true);
  });
});
