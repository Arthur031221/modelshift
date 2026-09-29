// Re-fetches the provider lifecycle pages and merges changes into registry/lifecycle.json.
// Used by .github/workflows/refresh-registry.yml. Run locally with: npm run build && npm run registry:refresh
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");
if (!existsSync(cli)) {
  console.error("dist/cli.js not found. Run npm run build first.");
  process.exit(2);
}
const result = spawnSync(
  process.execPath,
  [cli, "registry", "refresh", "--write", ...process.argv.slice(2)],
  {
    cwd: root,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
