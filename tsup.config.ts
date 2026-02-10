import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node18",
    clean: true,
    dts: false,
    sourcemap: false,
    splitting: false,
  },
  {
    entry: {
      cli: "src/cli.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: false,
    sourcemap: false,
    splitting: false,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
