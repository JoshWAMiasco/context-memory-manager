/*
 * Builds the desktop installers:
 *
 *   1. `npm run build`: the Next standalone server in dist/app (entry.js, migrations, static files)
 *      and the Electron main process and preload in dist/electron.
 *   2. Checks dist/app has the native binaries of the target platform and architecture
 *      (better-sqlite3 prebuild, @node-rs/argon2 package). Both are N-API, so Electron loads them
 *      as they are and nothing is rebuilt; npm only installs argon2 for the machine it runs on, so
 *      each installer is built on (or for) its own platform.
 *   3. Copies dist/docs/*.pdf (the guides, `npm run docs:pdf`) to dist/resources/docs.
 *   4. Runs electron-builder with electron-builder.yml.
 *
 * Usage: npm run build:desktop -- [--dir] [--skip-build] [--arch arm64|x64] [--targets dmg,AppImage,…]
 *   --dir         unpacked app only (dist/desktop/<platform>-unpacked or mac-arm64/CCM.app), for tests
 *   --skip-build  reuse dist/app and dist/electron from an earlier `npm run build`
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const applicationDirectory = path.join(projectRoot, "dist", "app");
const PLATFORM_FLAGS: Record<string, string> = { darwin: "--mac", win32: "--win", linux: "--linux" };

interface BuildOptions {
  isDirectoryOnly: boolean;
  shouldSkipBuild: boolean;
  arch: string;
  targets?: string;
}

function readOptions(argumentList: readonly string[]): BuildOptions {
  const readValue = (flag: string) => {
    const flagIndex = argumentList.indexOf(flag);
    return flagIndex === -1 ? undefined : argumentList[flagIndex + 1];
  };
  return {
    isDirectoryOnly: argumentList.includes("--dir"),
    shouldSkipBuild: argumentList.includes("--skip-build"),
    arch: readValue("--arch") ?? process.arch,
    targets: readValue("--targets"),
  };
}

function run(command: string, commandArguments: readonly string[], environment: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, commandArguments, {
    cwd: projectRoot,
    stdio: "inherit",
    env: environment,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArguments.join(" ")} failed (${result.status})`);
}

/** The native files the server needs on `platform`-`arch`; missing ones make the build fail early. */
function checkNativeBinaries(platform: string, arch: string): void {
  const sqlitePrebuild = path.join(
    applicationDirectory,
    "node_modules",
    "better-sqlite3",
    "prebuilds",
    `${platform}-${arch}.node`,
  );
  const argonDirectory = path.join(applicationDirectory, "node_modules", "@node-rs");
  const argonPackages = existsSync(argonDirectory) ? readdirSync(argonDirectory) : [];
  const argonPrefix = `argon2-${platform}-${arch}`;
  const problems: string[] = [];
  if (!existsSync(sqlitePrebuild))
    problems.push(`better-sqlite3 has no ${platform}-${arch} prebuild (${sqlitePrebuild})`);
  if (!argonPackages.some((packageName) => packageName.startsWith(argonPrefix))) {
    problems.push(`@node-rs/${argonPrefix}* is not installed (npm installs only the build machine's own package)`);
  }
  if (problems.length > 0) {
    throw new Error(
      `dist/app can't run on ${platform}-${arch}:\n  - ${problems.join("\n  - ")}\n` +
        "Build each installer on its own platform and architecture (see the README).",
    );
  }
}

function copyGuides(): number {
  const guidesDirectory = path.join(projectRoot, "dist", "docs");
  const targetDirectory = path.join(projectRoot, "dist", "resources", "docs");
  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true });
  if (!existsSync(guidesDirectory)) return 0;
  const guideFiles = readdirSync(guidesDirectory).filter((fileName) => fileName.endsWith(".pdf"));
  for (const guideFile of guideFiles) {
    copyFileSync(path.join(guidesDirectory, guideFile), path.join(targetDirectory, guideFile));
  }
  return guideFiles.length;
}

function buildDesktop(): void {
  const options = readOptions(process.argv.slice(2));
  const platformFlag = PLATFORM_FLAGS[process.platform];
  if (!platformFlag) throw new Error(`Desktop builds are not supported on ${process.platform}.`);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  if (!options.shouldSkipBuild) run(npmCommand, ["run", "build"]);
  if (!existsSync(path.join(projectRoot, "dist", "electron", "main.js"))) {
    throw new Error("dist/electron is missing; run without --skip-build.");
  }
  checkNativeBinaries(process.platform, options.arch);
  const guideCount = copyGuides();
  console.log(
    guideCount > 0
      ? `[build-desktop] bundling ${guideCount} PDF guide(s)`
      : "[build-desktop] no PDF guides in dist/docs yet (`npm run docs:pdf` builds them); Help › Desktop Guide will say so",
  );
  const builderArguments = ["electron-builder", "--config", "electron-builder.yml", platformFlag, `--${options.arch}`];
  if (options.isDirectoryOnly) builderArguments.push("--dir");
  else if (options.targets) builderArguments.push(...options.targets.split(","));
  // ELECTRON_RUN_AS_NODE (set in shells started from VS Code) would make electron-builder's Electron checks fail.
  const builderEnvironment: NodeJS.ProcessEnv = { ...process.env };
  delete builderEnvironment.ELECTRON_RUN_AS_NODE;
  const hasSigningIdentity = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
  if (!hasSigningIdentity) {
    // No certificate given: don't pick up whatever identity the keychain holds; macOS gets an ad-hoc signature.
    builderEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
    if (process.platform === "darwin") builderArguments.push("-c.mac.identity=-");
    console.log("[build-desktop] unsigned build (set CSC_LINK or CSC_NAME to sign)");
  }
  run(process.platform === "win32" ? "npx.cmd" : "npx", builderArguments, builderEnvironment);
  console.log(`[build-desktop] done: ${path.relative(projectRoot, path.join(projectRoot, "dist", "desktop"))}`);
}

try {
  buildDesktop();
} catch (buildError) {
  console.error(`[build-desktop] ${buildError instanceof Error ? buildError.message : String(buildError)}`);
  process.exit(1);
}
