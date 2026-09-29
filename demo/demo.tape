# Render with: brew install vhs && vhs demo/demo.tape
# Requires a built dist/ (npm run build) and Ollama with qwen3:1.7b and qwen3:4b pulled.
Output demo/demo.gif

Set Shell "zsh"
Set FontSize 14
Set Width 1100
Set Height 650
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Type "node dist/cli.js scan examples/sample-app"
Enter
Sleep 3s

Type "clear"
Enter

Type "node dist/cli.js replay --from qwen3:1.7b --to qwen3:4b --prompts demo/prompts.jsonl --no-think --limit 3"
Enter
Sleep 2s
Hide
Sleep 260s
Show
Sleep 5s

Type "clear"
Enter

Type "node dist/cli.js fix examples/sample-app"
Enter
Sleep 5s
