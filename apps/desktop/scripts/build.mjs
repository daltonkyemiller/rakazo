import { execFileSync } from "node:child_process";
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  banner: {
    js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);',
  },
  external: ["electron", "electron-updater", "koffi", "@sentry/electron"],
});

// Check the final bundle too: injected imports can collide with bundled source.
execFileSync(process.execPath, ["--check", "dist/main.js"], { stdio: "inherit" });
