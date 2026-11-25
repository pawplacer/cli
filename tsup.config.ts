import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node22",
  dts: true,
  clean: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
