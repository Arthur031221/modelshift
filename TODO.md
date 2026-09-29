# TODO

Remaining items from the build brief, with file paths and acceptance criteria. The code in this repository builds, lints, typechecks and passes its tests as committed. Everything below is additive.

## 1. Measured number from real repositories (README)

Brief: run `scan` against three or four popular open-source repos that hard-code model IDs and report "X model IDs retiring within 90 days across Y repos" with a method footnote.

- Clone shallowly into a temp dir, for example `langchain-ai/langchain` (the `docs/` and `libs/partners/openai` trees), `open-webui/open-webui`, `crewAIInc/crewAI`, `mckaywrigley/chatbot-ui`.
- Run `node dist/cli.js scan <dir> --known-only --json` per repo and sum `counts.retiring` and `counts.retired`.
- Edit `README.md`: replace the first paragraph's registry count with the repo measurement (keep the registry count as a second sentence if useful) and rewrite footnote `[^1]` with n repos, commit SHAs, date, registry version and the exact command.
- Acceptance: every number in the README first paragraph comes from a command that is written in the footnote and can be rerun.

## 2. Demo GIF

- `demo/demo.tape` exists and runs `scan`, `replay` (qwen3:1.7b to qwen3:4b on Ollama with `--no-think`) and `fix`.
- Install vhs (`brew install vhs`), run `npm run build`, make sure `ollama list` shows `qwen3:1.7b` and `qwen3:4b`, then `vhs demo/demo.tape`.
- Acceptance: `demo/demo.gif` under 5 MB, shows all three commands, referenced from `README.md` (the image tag is already there).

## 3. Replay against Ollama, full six-prompt run

- `node dist/cli.js replay --from qwen3:1.7b --to qwen3:4b --prompts demo/prompts.jsonl --no-think` has been run only with `--limit 2` before the commit (see the handoff notes in the final report).
- Run the full set, open `modelshift-report.html`, confirm the tool-call prompt (`tool-weather`) produces `tool_calls` through Ollama's native API and that `json-extract` and `json-list` are marked valid.
- If qwen3:1.7b never calls the tool, that is a real finding to keep. If the tool call arrives as text instead of `tool_calls`, extend `src/providers/ollama.ts` to parse a leading `<tool_call>{...}</tool_call>` block into `toolCalls`.
- Acceptance: the terminal summary and the HTML report show non-empty outputs for all six prompts on both models.

## 4. `--from-sessions` on real logs

- `src/replay/sessions.ts` was tested only with unit fixtures. Run `node dist/cli.js replay --from qwen3:1.7b --to qwen3:4b --from-sessions --n 5 --seed 1 --sample-only` on this machine and read `modelshift-sessions.jsonl`.
- Check that slash commands, tool results and system reminders are absent and that redaction did not mangle ordinary text.
- Acceptance: five plain user prompts in the file, no `<command-name>` or `<system-reminder>` content, and the confirmation prompt appears when `--sample-only` is removed and `--yes` is absent.

## 5. `fix --pr` end to end

- `src/commands/fix.ts` `openPullRequest()` shells out to `git` and `gh`. It has not been exercised against a real remote.
- Create a throwaway repository, push `examples/sample-app`, run `node dist/cli.js fix <clone> --pr`, and confirm the branch, commit message and PR body.
- Acceptance: one PR opened with the rewrite list in the body, exit code 0, and a clear error (exit 2) when `gh auth status` fails.

## 6. Registry refresh parser against the live pages

- `src/registry/refresh.ts` parsers were written from the page structure observed on 2026-09-29 but were not run against the live HTML.
- Run `node dist/cli.js registry refresh` (dry run) and compare the "updated" lines with the source pages. Fix column detection in `parseOpenAIHtml`, `parseGeminiHtml` and `parseBedrockHtml` as needed. `parseAnthropicMarkdown` reads the `.md` version of the Anthropic page and should be the most reliable.
- Add tests in `test/refresh.test.ts` with small HTML fixtures for each parser.
- Acceptance: a dry run on the current pages reports zero spurious updates for entries that already match, and `.github/workflows/refresh-registry.yml` produces a reviewable PR on `workflow_dispatch`.

## 7. Registry gaps (see `registry/UNVERIFIED.md`)

- Add Bedrock rows for the other Claude models once AWS publishes them, and Vertex AI model dates if a parseable page exists.
- Resolve the `cohere.command-r-v1:0` row and the `gpt-4-32k` family dates from the provider pages.
- Acceptance: each new entry has a `source` URL and `node dist/cli.js registry validate` passes.

## 8. Test coverage to add

- `test/walker.test.ts`: temp directory with nested `.gitignore` files, `node_modules`, a binary file and an oversized file. Assert which paths `walkFiles` yields.
- `test/cli.test.ts`: `--help` for every command, unknown command exit 2, default command when the first argument is a path.
- `test/refresh.test.ts`: see item 6.
- `src/commands/replay.ts` `--from-sessions` flow with `io.confirm` injected.
- Acceptance: `npm test` stays under 30 seconds.

## 9. Publish and release

- `npm publish` as `modelshift@0.1.0` (name verified free on npm on 2026-09-29), then tag `v0.1.0` so `uses: Arthur031221/modelshift@v0.1.0` in `action.yml` resolves.
- Add a `release.yml` workflow that publishes on tag push with `NPM_TOKEN`.
- Acceptance: `npx modelshift@0.1.0 --version` prints `0.1.0`.

## 10. Small polish

- `src/commands/scan.ts`: consider hiding unknown Ollama tags by default in large repos (currently shown, `--known-only` hides them).
- `src/fix/index.ts`: the `--no-think` equivalent for OpenAI (`reasoning_effort`) is not implemented, document or add it.
- README: add a screenshot of `modelshift-report.html` under the demo GIF.
