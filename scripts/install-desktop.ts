/*
 * Installs the desktop app built from this checkout on this Mac (`npm run install:desktop`), the
 * same way each time:
 *
 *   1. Builds it (skip with --skip-build) and signs it with the local signing identity named in
 *      .cmm-local.json ({ "signingIdentity": "Apple Development: …" }, not committed). A stable
 *      identity lets macOS keep CMM's Files and Folders permissions across updates; without one the
 *      app stays ad-hoc signed and macOS asks again after every update.
 *   2. Refuses while CMM is running a job (a backup, an encryption…), unless --force: quitting
 *      pauses it, and it has to be resumed by hand.
 *   3. Quits CMM, keeps the installed app for --rollback, installs the new one, checks its
 *      signature and version, and opens it (not with --no-open).
 *
 * `npm run install:desktop -- --rollback` puts the kept version back. CMM's data (database,
 * settings, profiles) lives in ~/Library/Application Support/CMM and is never touched: each
 * version migrates it on start.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const projectRoot = path.resolve(__dirname, "..");
const INSTALLED_APP = "/Applications/CMM.app";
const DATA_DIRECTORY = path.join(homedir(), "Library", "Application Support", "CMM");
const ROLLBACK_APP = path.join(DATA_DIRECTORY, "rollback", "CMM.app");
const BUILT_APP = path.join(projectRoot, "dist", "desktop", `mac-${process.arch}`, "CMM.app");
const QUIT_TIMEOUT_MILLISECONDS = 30_000;

const options = {
  skipBuild: process.argv.includes("--skip-build"),
  force: process.argv.includes("--force"),
  rollback: process.argv.includes("--rollback"),
  noOpen: process.argv.includes("--no-open"),
};

function log(message: string): void {
  console.log(`[install-desktop] ${message}`);
}

function run(command: string, commandArguments: readonly string[], { quiet = false } = {}): string {
  const result = spawnSync(command, commandArguments, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: quiet ? "pipe" : ["ignore", "inherit", "inherit"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${commandArguments.join(" ")} failed (${result.status})${quiet ? `: ${result.stderr}` : ""}`,
    );
  }
  return result.stdout ?? "";
}

function readSigningIdentity(): string | undefined {
  const localConfigPath = path.join(projectRoot, ".cmm-local.json");
  if (!existsSync(localConfigPath)) return undefined;
  const localConfig = JSON.parse(readFileSync(localConfigPath, "utf8")) as { signingIdentity?: unknown };
  return typeof localConfig.signingIdentity === "string" ? localConfig.signingIdentity : undefined;
}

function readAppVersion(appPath: string): string {
  return run("defaults", ["read", path.join(appPath, "Contents", "Info.plist"), "CFBundleShortVersionString"], {
    quiet: true,
  }).trim();
}

function isCmmRunning(): boolean {
  return spawnSync("pgrep", ["-f", `${INSTALLED_APP}/Contents/MacOS/`]).status === 0;
}

/** The jobs CMM is running or about to run: quitting would pause them. */
function readActiveJobs(): { type: string; title: string }[] {
  const databasePath = path.join(DATA_DIRECTORY, "cmm.db");
  if (!existsSync(databasePath)) return [];
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const rows = database
      .prepare("SELECT type, payload_json AS payloadJson FROM jobs WHERE status IN ('running', 'queued')")
      .all() as { type: string; payloadJson: string | null }[];
    return rows.map((row) => {
      let title = row.type;
      try {
        title = (JSON.parse(row.payloadJson ?? "{}") as { name?: string }).name ?? row.type;
      } catch {
        // The type is name enough.
      }
      return { type: row.type, title };
    });
  } finally {
    database.close();
  }
}

/** Asks CMM to quit (it pauses its jobs and stops its server) and waits for it. */
function quitCmm(): void {
  if (!isCmmRunning()) return;
  log("Quitting CMM…");
  spawnSync("osascript", ["-e", 'quit app "CMM"']);
  const deadline = Date.now() + QUIT_TIMEOUT_MILLISECONDS;
  while (isCmmRunning()) {
    if (Date.now() > deadline) throw new Error("CMM didn't quit within 30 seconds. Quit it yourself and try again.");
    spawnSync("sleep", ["0.5"]);
  }
}

function signApp(appPath: string, identity: string): void {
  log(`Signing with "${identity}"…`);
  run("codesign", [
    "--force",
    "--deep",
    "--options",
    "runtime",
    "--timestamp=none",
    "--entitlements",
    path.join(projectRoot, "electron", "entitlements.mac.plist"),
    "--sign",
    identity,
    appPath,
  ]);
}

function installApp(sourceApp: string): void {
  run("codesign", ["--verify", "--deep", "--strict", sourceApp]);
  quitCmm();
  if (existsSync(INSTALLED_APP)) {
    rmSync(ROLLBACK_APP, { recursive: true, force: true });
    run("mkdir", ["-p", path.dirname(ROLLBACK_APP)]);
    renameSync(INSTALLED_APP, ROLLBACK_APP);
  }
  run("ditto", [sourceApp, INSTALLED_APP]);
  run("codesign", ["--verify", "--deep", "--strict", INSTALLED_APP]);
}

function main(): void {
  if (process.platform !== "darwin") {
    throw new Error(
      "install:desktop installs the macOS app. On Windows and Linux, run the installer from dist/desktop.",
    );
  }
  const activeJobs = readActiveJobs();
  if (activeJobs.length > 0 && !options.force) {
    throw new Error(
      `CMM is busy: ${activeJobs.map((job) => job.title).join(", ")}. Quitting would pause it. ` +
        "Wait for it to finish, or run again with --force (resume it in CMM afterwards).",
    );
  }

  if (options.rollback) {
    if (!existsSync(ROLLBACK_APP)) throw new Error("There is no previous version to go back to.");
    const rollbackVersion = readAppVersion(ROLLBACK_APP);
    quitCmm();
    const currentApp = `${ROLLBACK_APP}.current`;
    rmSync(currentApp, { recursive: true, force: true });
    if (existsSync(INSTALLED_APP)) renameSync(INSTALLED_APP, currentApp);
    renameSync(ROLLBACK_APP, INSTALLED_APP);
    if (existsSync(currentApp)) renameSync(currentApp, ROLLBACK_APP);
    log(`Rolled back to CMM ${rollbackVersion}. Run --rollback again to return.`);
  } else {
    if (!options.skipBuild) run("npm", ["run", "build:desktop"]);
    if (!existsSync(BUILT_APP)) throw new Error(`No built app at ${BUILT_APP}. Run without --skip-build.`);
    const identity = readSigningIdentity();
    if (identity) signApp(BUILT_APP, identity);
    else
      log("No signingIdentity in .cmm-local.json: the app stays ad-hoc signed, so macOS asks for permissions again.");
    const previousVersion = existsSync(INSTALLED_APP) ? readAppVersion(INSTALLED_APP) : undefined;
    installApp(BUILT_APP);
    log(
      `Installed CMM ${readAppVersion(INSTALLED_APP)}${previousVersion ? ` (was ${previousVersion}; --rollback goes back)` : ""}.`,
    );
  }
  if (!options.noOpen) run("open", [INSTALLED_APP]);
}

try {
  main();
} catch (installError) {
  console.error(`[install-desktop] ${installError instanceof Error ? installError.message : String(installError)}`);
  process.exit(1);
}
