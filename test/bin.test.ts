import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist", "cli.js");

describe("bin", () => {
  it("exits 0 instead of crashing when the reader closes the pipe early (EPIPE)", async () => {
    // `head -n 1` reads one line and exits, closing its end of the pipe while
    // modelshift is still writing the rest of the diff to stdout.
    const result = await execFileAsync("bash", [
      "-c",
      `node ${cli} fix examples/sample-app | head -n 1 >/dev/null; exit \${PIPESTATUS[0]}`,
    ]).then(
      () => ({ code: 0, stderr: "" }),
      (error) => ({ code: error.code as number, stderr: String(error.stderr ?? "") }),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/EPIPE/);
  });
});
