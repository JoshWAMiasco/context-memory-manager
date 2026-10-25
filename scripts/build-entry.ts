/*
 * Bundles server/entry.ts into dist/server/entry.js and the `ccm` admin CLI (server/cli/index.ts)
 * into dist/cli/ccm.js (CommonJS, Node 22). Next and the native packages stay external: at runtime
 * they resolve from the app's own node_modules. The CLI's pure-JS dependencies (selfsigned) are
 * bundled in.
 */
import path from "node:path";
import { build } from "esbuild";

const projectRoot = path.resolve(__dirname, "..");

const EXTERNAL_PACKAGES = [
  "next",
  "better-sqlite3",
  "@node-rs/argon2",
  "chokidar",
  "systeminformation",
  "simple-git",
  "trash",
  "archiver",
];

async function bundle(entryPoint: string, outfile: string): Promise<void> {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: true,
    external: EXTERNAL_PACKAGES,
    alias: { "server-only": "./scripts/stubs/server-only.cjs" },
    logLevel: "warning",
  });
  console.log(`[build-entry] wrote ${outfile}`);
}

async function buildEntry(): Promise<void> {
  await bundle("server/entry.ts", "dist/server/entry.js");
  await bundle("server/cli/index.ts", "dist/cli/ccm.js");
}

buildEntry().catch((buildError: unknown) => {
  console.error(buildError);
  process.exit(1);
});
