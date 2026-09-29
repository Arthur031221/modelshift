# Entries excluded from lifecycle.json pending verification

The bundled registry only contains dates that were read from a provider page on 2026-09-29. The items below could not be confirmed from those pages and are therefore not in `lifecycle.json`. Pull requests that add them with a source link are welcome.

## Google Vertex AI

- The Vertex AI deprecations page (`https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations`) lists only the Vertex AI SDK generative module (deprecated 2025-06-24, removed 2026-06-24). It contains no per-model rows.
- The Vertex "Model versions and lifecycle" page returned navigation markup only when fetched, so no Vertex-specific model dates were recorded.
- Vertex spellings of Anthropic models (`claude-haiku-4-5@20251001` and similar) are not in the registry. Google sets its own retirement schedule for those, and the Anthropic first-party dates do not apply to them.

## Amazon Bedrock

- `cohere.command-r-v1:0`: the row on the legacy lifecycle page was parsed with shifted columns. The dates appear to match `cohere.command-r-plus-v1:0` (legacy 2026-02-19, EOL 2026-08-19) but this was not confirmed.
- Models launched on Bedrock on or after 2026-09-07 follow the new lifecycle page (`https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html`), which had no legacy or EOL rows when fetched.
- Bedrock IDs for Claude models other than the three legacy rows (for example `anthropic.claude-3-5-sonnet-20241022-v2:0`) are not in the registry because the AWS page does not list them. The scanner reports them as unknown and points to the Anthropic first-party entry.

## OpenAI

- `gpt-4-32k`, `gpt-4-32k-0613`, `gpt-4-32k-0314`, `gpt-4-vision-preview`, `gpt-4-1106-vision-preview`: the 2024-06-06 announcement lists two shutdown dates (2025-06-06 and 2025-12-06) for the group without a per-model split in the fetched text. All five are retired, but the exact date per model was not recorded.
- `gpt-4-1106-preview` appears in the 2026-04-22 table (shutdown 2026-10-23). An earlier summary of the page also placed it in the 2025-09-26 group. The registry keeps the 2026-04-22 row.
- The 2023-07-06 announcement (`ada`, `babbage`, `curie`, `davinci`, `text-*-001`, `code-*`, first generation embedding models) is not in the registry except for `text-davinci-002` and `text-davinci-003`. Replacements for the rest were not printed per model.
- Fine-tuned model prefixes (`ft-gpt-4`, `ft-gpt-3.5-turbo`, `ft-babbage-002`, `ft-davinci-002`, `ft-o4-mini-2025-04-16`, `ft-gpt-4.1-nano-2025-04-14`) are omitted. Fine-tuned model IDs are per organisation and do not appear literally in source code.
- Non-model deprecations (Assistants API, Prompts API, Evals platform, Agent Builder, Videos API, Realtime API beta) are outside the scope of the registry.

## Google Gemini API

- Replacements for retired preview snapshots (`gemini-2.5-pro-preview-*`, `gemini-2.5-flash-preview-*`, `gemini-2.0-*-exp`) are not named in the changelog. The registry records them with `replacement: null`.
- `gemini-1.0-pro` and its alias `gemini-pro`: the changelog says "no longer supported" as of 2025-02-18 without a shutdown date. The registry records a deprecation date and no retirement date.
- Aliases for Gemini 1.5 models (`-latest`, `-001`, `-002`) are recorded from the model naming convention, not from a lifecycle table.

## Anthropic

- The `-latest` aliases for Claude 3 series models (`claude-3-7-sonnet-latest`, `claude-3-5-haiku-latest`, `claude-3-5-sonnet-latest`, `claude-3-opus-latest`) and the `claude-opus-4-0`, `claude-sonnet-4-0`, `claude-opus-4-1` aliases are recorded from Anthropic's model documentation as it stood before those models retired. They resolve to retired entries either way.
