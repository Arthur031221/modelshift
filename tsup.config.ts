import { defineConfig } from "tsup";

export default defineConfig({
  entry: { cli: "src/bin.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
  banner: { js: "#!/usr/bin/env node" },
});
