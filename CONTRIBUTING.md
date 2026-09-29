# Contributing

## Setup

```
git clone https://github.com/Arthur031221/modelshift
cd modelshift
npm ci
npm run build
node dist/cli.js scan examples/sample-app
```

`npm test` runs the vitest suite. Every provider call is mocked, so the tests need no API keys and no network. `npm run lint` runs Biome, `npm run typecheck` runs tsc.

## Registry changes

`registry/lifecycle.json` is the part of this project most likely to need a fix. Rules:

- Every entry needs a `source` URL that points at the provider page the dates came from.
- Do not guess dates. If a provider page is ambiguous, put the model in `registry/UNVERIFIED.md` instead.
- Run `node dist/cli.js registry validate` before opening a pull request. CI runs it too.
- `node dist/cli.js registry refresh` re-fetches the provider pages and prints what would change. The parsers are best effort, so read the diff.

## Code changes

- Keep the dependency count low. The runtime dependencies are `diff` and `ignore`.
- Add a test next to the feature in `test/`. Prefer small fixtures over large ones.
- Provider adapters take a `fetchImpl` so tests can pass a fake `fetch`.
- Run `npm run lint:fix` before committing.

## Pull requests

One change per pull request. Describe what you ran to verify it. For registry changes paste the relevant lines from the provider page.
