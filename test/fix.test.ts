import { describe, expect, it } from "vitest";
import { findPromptFlags, planFileFix, stripSamplingParams } from "../src/fix/index.js";
import { loadRegistry, RegistryIndex } from "../src/registry/index.js";

const index = new RegistryIndex(loadRegistry());
const opts = { root: ".", days: 90, today: "2026-09-30", index };

const PY = `client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=512,
    temperature=0.7,
    top_p=0.9,
    system="Think step by step before answering.",
)
other = openai.chat.completions.create(model="gpt-4o-2024-05-13", temperature=0.2)
`;

describe("fix", () => {
  it("rewrites retiring ids, strips rejected parameters and flags prompts", () => {
    const result = planFileFix(PY, "app.py", "/app.py", opts);
    expect(result.change).not.toBeNull();
    const after = result.change!.after;
    expect(after).toContain('model="claude-sonnet-4-6"');
    expect(after).toContain('model="gpt-5.6-sol"');
    // Sonnet 4.6 still accepts sampling parameters, so nothing is stripped here.
    expect(after).toContain("temperature=0.7");
    expect(result.change!.rewrites.map((r) => `${r.from}>${r.to}`)).toEqual([
      "claude-3-5-sonnet-20241022>claude-sonnet-4-6",
      "gpt-4o-2024-05-13>gpt-5.6-sol",
    ]);
    expect(result.flags.map((f) => f.pattern)).toEqual(["think step by step"]);
  });

  it("strips temperature, top_p and top_k around models that reject them", () => {
    const lines = [
      "resp = client.messages.create(",
      '    model="claude-opus-4-8",',
      "    temperature=0.7,",
      '    "top_p": 0.9,',
      "    max_tokens=1024,",
      ")",
      "",
      'other = create(model="claude-opus-5", temperature=0.3, max_tokens=5)',
    ];
    const { lines: out, stripped } = stripSamplingParams(lines);
    expect(out).toEqual([
      "resp = client.messages.create(",
      '    model="claude-opus-4-8",',
      "    max_tokens=1024,",
      ")",
      "",
      'other = create(model="claude-opus-5", max_tokens=5)',
    ]);
    expect(stripped).toHaveLength(3);
  });

  it("is idempotent", () => {
    const first = planFileFix(PY, "app.py", "/app.py", opts);
    const second = planFileFix(first.change!.after, "app.py", "/app.py", opts);
    expect(second.change).toBeNull();
  });

  it("only flags prompt text in files that mention an Anthropic model", () => {
    expect(findPromptFlags('model = "gpt-4"\nprompt = "think step by step"', "a.py")).toEqual([]);
    expect(
      findPromptFlags('model = "claude-opus-4-8"\nprompt = "think step by step"', "a.py"),
    ).toHaveLength(1);
    expect(findPromptFlags("claude-opus-4-8 step-by-step guide", "README.md")).toEqual([]);
  });
});
