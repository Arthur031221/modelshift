# Roadmap

Known gaps, with enough detail to pick one up. Pull requests welcome, see `CONTRIBUTING.md`.

## Registry refresh parsers need a pass against the live pages

`registry refresh` (dry run) against the current provider pages turns up real issues:

- The Gemini parser (`parseGeminiHtml`) returns 0 rows against the live deprecations page. The page structure has likely changed since 2026-09-29 and the table selector needs updating.
- The OpenAI parser finds about 40 legacy entries not yet in the bundled registry (completions-era fine-tune base models, early embedding and search models) and a couple of field mismatches. One is a data cleanliness bug: the source page uses an em dash for "no replacement" in some rows, and the parser copies that character into the `replacement` field literally instead of normalizing it to `null`.
- `parseAnthropicMarkdown` and `parseBedrockHtml` look solid on a spot check, worth a second look with fixtures.

Add small HTML fixtures per parser in `test/refresh.test.ts` so a page redesign fails a test instead of failing silently. Confirm `.github/workflows/refresh-registry.yml` actually produces a reviewable pull request on `workflow_dispatch`.

## Registry gaps

See `registry/UNVERIFIED.md` for the full list with sources checked so far. The short version:

- Bedrock rows for Claude models beyond the three legacy entries, once AWS publishes them.
- Vertex AI model dates, if a parseable page exists (the current page has no per-model table).
- The `cohere.command-r-v1:0` Bedrock row has shifted columns on the source page and needs a manual check.
- `gpt-4-32k` family: the OpenAI announcement gives two shutdown dates for the group without a per-model split.

Every new entry needs a `source` URL, and `registry validate` needs to keep passing.

## `fix --pr` has not been run against a real GitHub remote

The dry run and `--write` paths are tested. The `--pr` path (branch, commit, push, `gh pr create`) has only been exercised with mocked `git` and `gh`. Run it once against a throwaway repository and confirm the branch name, commit message, PR body, and the exit-2 error path when `gh auth status` fails.

## Test coverage

- `walkFiles` with nested `.gitignore` files, `node_modules`, a binary file, and an oversized file.
- `--help` for every command, an unknown command's exit code, and the default command when the first argument is a path.
- The `--from-sessions` flow in `replay` with `io.confirm` injected, covering the abort path and the `--yes` path.

## npm publish

The package is not yet published to npm. `npx github:Arthur031221/modelshift` and a `git clone` plus `npm install -g` both work today, see the README. Publishing `modelshift@0.1.0` and wiring `release.yml` to `NPM_TOKEN` is future work.

## Small polish

- `scan`: consider hiding unknown identifiers by default in large repos. `--known-only` already does this on request.
- `fix`: OpenAI's `reasoning_effort` equivalent of `--no-think` is not implemented.
- README: add a screenshot of `modelshift-report.html` under the demo GIF.
