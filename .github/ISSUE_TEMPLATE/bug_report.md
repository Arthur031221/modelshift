---
name: Bug report
about: Something scanned, replayed, or fixed incorrectly
title: ""
labels: bug
assignees: ""
---

## What happened

Describe the incorrect behaviour in one or two sentences.

## Command

The exact command you ran, with `--json` output if possible.

```
npx modelshift scan --days 90 --json
```

## Expected

What you expected instead.

## Environment

- modelshift version (`npx modelshift --version`):
- Node version (`node --version`):
- OS:
- Provider and base URL (for replay issues, no API keys please):

## Registry entry

If a model was classified wrongly, paste the entry from `registry/lifecycle.json` and link the provider page that contradicts it.
