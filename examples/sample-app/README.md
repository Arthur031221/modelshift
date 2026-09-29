# sample-app

A small fake application used by the modelshift demo. It hard-codes model IDs in Python, TypeScript, YAML and an env file so that `modelshift scan examples/sample-app` has something to find.

The default production model is `gpt-5.6-sol`. Local development uses `qwen3:4b` through Ollama.
