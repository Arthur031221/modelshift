import { describe, expect, it } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { guessPreset } from "../src/providers/index.js";
import { OpenAICompatibleProvider } from "../src/providers/openai.js";
import type { Provider } from "../src/providers/types.js";
import { checkJson, isRefusal, lexicalSimilarity, toolShape } from "../src/replay/metrics.js";
import { loadPrices, priceFor } from "../src/replay/prices.js";
import { parsePromptsJsonl } from "../src/replay/prompts.js";
import { renderHtmlReport } from "../src/replay/report.js";
import { runReplay } from "../src/replay/runner.js";
import { extractClaudeUserText, extractCodexUserText } from "../src/replay/sessions.js";
import { redactSecrets } from "../src/util/secrets.js";

function fakeFetch(
  body: unknown,
  capture?: (init: RequestInit, url: string) => void,
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture?.(init ?? {}, String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("metrics", () => {
  it("checks JSON strictly and after extraction", () => {
    expect(checkJson('{"a":1}')).toEqual({ valid: true, strict: true });
    expect(checkJson('Sure:\n```json\n{"a":1}\n```')).toEqual({ valid: true, strict: false });
    expect(checkJson("not json")).toEqual({ valid: false, strict: false });
  });

  it("detects refusal phrases", () => {
    expect(isRefusal("I'm sorry, but I can't help with that request.")).toBe(true);
    expect(isRefusal("I cannot assist with picking locks.")).toBe(true);
    expect(isRefusal("Here is the JSON you asked for.")).toBe(false);
  });

  it("computes lexical similarity and tool shape", () => {
    expect(lexicalSimilarity("the cat sat", "the cat sat")).toBeCloseTo(1);
    expect(lexicalSimilarity("alpha beta", "gamma delta")).toBe(0);
    const shape = toolShape(
      [{ name: "get_weather", arguments: '{"unit":"c"}' }],
      [{ name: "get_weather", parameters: { type: "object", required: ["city"] } }],
    );
    expect(shape.missingRequired).toEqual(["get_weather.city"]);
  });
});

describe("providers", () => {
  it("parses OpenAI compatible responses and strips think tags", async () => {
    let sent: Record<string, unknown> = {};
    const provider = new OpenAICompatibleProvider({
      baseUrl: "http://localhost:11434/v1",
      fetchImpl: fakeFetch(
        {
          choices: [
            {
              message: {
                content: '<think>hmm</think>{"ok":true}',
                tool_calls: [{ function: { name: "f", arguments: "{}" } }],
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
        (init) => {
          sent = JSON.parse(String(init.body)) as Record<string, unknown>;
        },
      ),
    });
    const r = await provider.chat({
      model: "qwen3:4b",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 64,
      jsonMode: true,
    });
    expect(r.text).toBe('{"ok":true}');
    expect(r.thinking).toBe("hmm");
    expect(r.toolCalls[0]!.name).toBe("f");
    expect(r.inputTokens).toBe(10);
    expect(sent.max_tokens).toBe(64);
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("parses Anthropic messages and refusal stop reasons", async () => {
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      fetchImpl: fakeFetch({
        content: [
          { type: "text", text: "no" },
          { type: "tool_use", name: "t", input: { a: 1 } },
        ],
        stop_reason: "refusal",
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    });
    const r = await provider.chat({
      model: "claude-opus-4-8",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
    });
    expect(r.providerRefusal).toBe(true);
    expect(r.toolCalls[0]!.arguments).toBe('{"a":1}');
  });

  it("parses Gemini responses", async () => {
    const provider = new GeminiProvider({
      baseUrl: "https://generativelanguage.googleapis.com",
      apiKey: "k",
      fetchImpl: fakeFetch({
        candidates: [
          {
            content: {
              parts: [{ text: "hello" }, { functionCall: { name: "g", args: { q: 1 } } }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 2 },
      }),
    });
    const r = await provider.chat({
      model: "gemini-2.5-flash",
      messages: [{ role: "user", content: "u" }],
    });
    expect(r.text).toBe("hello");
    expect(r.toolCalls[0]!.name).toBe("g");
  });

  it("guesses presets from model ids", () => {
    expect(guessPreset("claude-opus-4-8")).toBe("anthropic");
    expect(guessPreset("gemini-2.5-flash")).toBe("gemini");
    expect(guessPreset("gpt-5.6-sol")).toBe("openai");
    expect(guessPreset("qwen3:4b")).toBe("ollama");
  });

  it("prices known models and treats local servers as free", () => {
    const prices = loadPrices();
    expect(priceFor("gpt-4o-2024-08-06", "openai", prices)).toEqual({ input: 2.5, output: 10 });
    expect(priceFor("qwen3:4b", "ollama", prices)).toEqual({ input: 0, output: 0 });
    expect(priceFor("mystery-model", "openai", prices)).toBeNull();
  });
});

describe("replay runner", () => {
  function scripted(answers: Record<string, string>, name: string): Provider {
    return {
      kind: "openai",
      name,
      baseUrl: "http://fake",
      async chat(req) {
        const prompt = req.messages[req.messages.length - 1]!.content;
        return {
          text: answers[prompt] ?? "",
          toolCalls: [],
          inputTokens: 5,
          outputTokens: 5,
          latencyMs: 10,
          finishReason: "stop",
          providerRefusal: false,
        };
      },
    };
  }

  it("reports regressions and renders a report", async () => {
    const prompts = parsePromptsJsonl(
      '{"id":"a","prompt":"give json","expect":"json"}\n{"id":"b","prompt":"lock"}',
    );
    const report = await runReplay({
      from: {
        model: "m1",
        provider: scripted({ "give json": '{"x":1}', lock: "Sure, here is how." }, "ollama"),
      },
      to: {
        model: "m2",
        provider: scripted(
          { "give json": "nope", lock: "I'm sorry, but I can't help with that." },
          "ollama",
        ),
      },
      prompts,
      prices: loadPrices(),
    });
    expect(report.aggregate.jsonValid).toEqual({ from: 1, to: 0 });
    expect(report.aggregate.refusals).toEqual({ from: 0, to: 1 });
    expect(report.results[0]!.regressions).toContain("json broke");
    expect(report.results[1]!.regressions).toContain("new refusal");
    expect(report.aggregate.totalCostUsd).toEqual({ from: 0, to: 0 });
    const html = renderHtmlReport(report);
    expect(html).toContain("modelshift replay: m1 to m2");
    expect(html).toContain("json broke");
  });
});

describe("sessions", () => {
  it("extracts user turns and skips meta lines", () => {
    expect(
      extractClaudeUserText(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "fix the tests please" },
        }),
      ),
    ).toBe("fix the tests please");
    expect(
      extractClaudeUserText(
        JSON.stringify({ type: "user", isMeta: true, message: { role: "user", content: "x" } }),
      ),
    ).toBeNull();
    expect(
      extractClaudeUserText(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "<command-name>/model</command-name>" },
        }),
      ),
    ).toBeNull();
    expect(
      extractClaudeUserText(
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", content: "x" }] },
        }),
      ),
    ).toBeNull();
    expect(
      extractCodexUserText(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "hello codex" }],
          },
        }),
      ),
    ).toBe("hello codex");
  });

  it("redacts secrets", () => {
    const r = redactSecrets(
      "key sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 and AKIAABCDEFGHIJKLMNOP and password=supersecretvalue123",
    );
    expect(r.text).not.toContain("sk-proj-");
    expect(r.text).not.toContain("AKIA");
    expect(r.text).toContain("password=[REDACTED]");
    expect(r.redactions).toBe(3);
  });
});
