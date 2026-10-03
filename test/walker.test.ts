import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTextFile, walkFiles } from "../src/scan/walker.js";

describe("file walker", () => {
  it("honours nested gitignores, skips dependency directories, and rejects binary or oversized text", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "modelshift-walker-"));
    try {
      await writeFile(path.join(root, ".gitignore"), "ignored.py\n");
      await writeFile(path.join(root, "keep.ts"), 'const model = "gpt-4o";');
      await writeFile(path.join(root, "ignored.py"), 'model = "gpt-4o"');
      await writeFile(path.join(root, "binary.ts"), Buffer.from([0x00, 0x01, 0x02]));
      await writeFile(path.join(root, "large.ts"), Buffer.alloc(2 * 1024 * 1024 + 1, 0x61));
      await writeFile(path.join(root, "notes.csv"), "not scanned");
      await writeFile(path.join(root, "package-lock.json"), "not scanned");

      await mkdir(path.join(root, "node_modules", "sample"), { recursive: true });
      await writeFile(path.join(root, "node_modules", "sample", "index.ts"), "not scanned");
      await mkdir(path.join(root, "nested"), { recursive: true });
      await writeFile(path.join(root, "nested", ".gitignore"), "hidden.yaml\n");
      await writeFile(path.join(root, "nested", "visible.yaml"), 'model: "gpt-4o"');
      await writeFile(path.join(root, "nested", "hidden.yaml"), 'model: "gpt-4o"');

      const files: string[] = [];
      for await (const file of walkFiles({ root })) files.push(path.relative(root, file));

      expect(files.sort()).toEqual(["binary.ts", "keep.ts", "large.ts", "nested/visible.yaml"]);
      expect(await readTextFile(path.join(root, "keep.ts"))).toContain("gpt-4o");
      expect(await readTextFile(path.join(root, "binary.ts"))).toBeNull();
      expect(await readTextFile(path.join(root, "large.ts"))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
