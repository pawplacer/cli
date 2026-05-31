import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  minify: false,
  splitting: false,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
