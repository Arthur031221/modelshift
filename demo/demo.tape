# Render with: brew install vhs && vhs demo/demo.tape
# Requires a built dist/ (npm run build) and Ollama with qwen3:1.7b and qwen3:4b pulled.
Output demo/demo.gif

Set Shell "zsh"
Set FontSize 15
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Type "node dist/cli.js scan examples/sample-app"
Enter
Sleep 4s

Type "clear"
Enter

Type "node dist/cli.js replay --from qwen3:1.7b --to qwen3:4b --prompts demo/prompts.jsonl --no-think --quiet"
Enter
Sleep 60s

Type "clear"
Enter

Type "node dist/cli.js fix examples/sample-app"
Enter
Sleep 6s
