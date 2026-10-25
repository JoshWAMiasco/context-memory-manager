/*
 * Bundles the desktop app's main process and preload into dist/electron/, which
 * is both what `electron dist/electron` runs in development and tests, and the app folder
 * electron-builder packs into app.asar:
 *
 *   dist/electron/main.js       electron/main.ts and its modules (Electron stays external)
 *   dist/electron/preload.js    electron/preload.ts, one file, as the sandbox requires
 *   dist/electron/splash.html   the splash window, with logo.svg next to it
 *   dist/electron/package.json  name, version and entry; no dependencies (the server lives in resources/)
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const projectRoot = path.resolve(__dirname, "..");
const outputDirectory = path.join(projectRoot, "dist", "electron");

interface RootPackage {
  version: string;
  description: string;
}

async function buildElectron(): Promise<void> {
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  await build({
    absWorkingDir: projectRoot,
    entryPoints: { main: "electron/main.ts", preload: "electron/preload.ts" },
    outdir: outputDirectory,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    sourcemap: true,
    external: ["electron"],
    logLevel: "warning",
  });
  copyFileSync(path.join(projectRoot, "electron", "splash.html"), path.join(outputDirectory, "splash.html"));
  copyFileSync(path.join(projectRoot, "public", "icons", "cmm", "logo.svg"), path.join(outputDirectory, "logo.svg"));
  const rootPackage = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as RootPackage;
  const desktopPackage = {
    name: "cmm",
    productName: "CMM",
    version: rootPackage.version,
    description: rootPackage.description,
    author: "CMM",
    main: "main.js",
    private: true,
  };
  writeFileSync(path.join(outputDirectory, "package.json"), `${JSON.stringify(desktopPackage, null, 2)}\n`);
  console.log("[build-electron] wrote dist/electron");
}

buildElectron().catch((buildError: unknown) => {
  console.error(buildError);
  process.exit(1);
});
