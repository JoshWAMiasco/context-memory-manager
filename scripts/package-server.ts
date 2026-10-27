/*
 * Builds the offline server package for Ubuntu:
 *
 *   dist/cmm-server-<version>-linux-<arch>/   and   dist/cmm-server-<version>-linux-<arch>.tar.gz (+ .sha256)
 *
 *   app/        dist/app (entry.js, cli.js, the Next standalone server, static files, migrations)
 *               with the target's native modules only
 *   node/       the Node 22 runtime for the target (bin/node), from vendor/node, checked against the
 *               pinned vendor/node/SHASUMS256.txt
 *   bin/cmm     starts app/cli.js with node/bin/node
 *   deploy/     cmm.service, the udisks2 polkit rules, config.example.json, Caddyfile.example
 *   install.sh  uninstall.sh  README-INSTALL.txt  VERSION  ARCH  BUILD-INFO.txt
 *   docs/       CMM-Server-Guide.pdf, when `npm run docs:pdf` has built it (dist/docs)
 *
 * Native modules: better-sqlite3 and @node-rs/argon2 are N-API prebuilds, so nothing is compiled.
 * better-sqlite3 ships `prebuilds/linux-<arch>.node` in its npm package; the argon2 package for
 * the target (`@node-rs/argon2-linux-<arch>-gnu`, glibc) is packed with `npm pack` into
 * vendor/native once per build machine and must match the integrity recorded in package-lock.json.
 * node-pty is the exception: it has no Linux prebuild, so the package carries the build/Release/pty.node
 * that npm ci compiled, and must be built on Linux for the target architecture.
 * The package is then checked: every native binary is an ELF file for the target, no package.json
 * keeps an install script, and the offline URL scan passes on the package's files.
 *
 * Usage: npx tsx scripts/package-server.ts --arch x64|arm64 [--skip-build]
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const NODE_VERSION = "22.23.3";
const TARGET_ARCHITECTURES = ["x64", "arm64"] as const;
type TargetArchitecture = (typeof TARGET_ARCHITECTURES)[number];

/** ELF `e_machine` values: what a Linux binary for each target must say. */
const ELF_MACHINES: Record<TargetArchitecture, number> = { x64: 0x3e, arm64: 0xb7 };
const INSTALL_SCRIPT_NAMES = ["preinstall", "install", "postinstall", "prepare"];

interface PackageOptions {
  arch: TargetArchitecture;
  shouldSkipBuild: boolean;
}

function log(message: string): void {
  console.log(`[package-server] ${message}`);
}

function readOptions(argumentList: readonly string[]): PackageOptions {
  const archIndex = argumentList.indexOf("--arch");
  const arch = archIndex === -1 ? undefined : argumentList[archIndex + 1];
  if (!TARGET_ARCHITECTURES.includes(arch as TargetArchitecture)) {
    throw new Error("Usage: npx tsx scripts/package-server.ts --arch x64|arm64 [--skip-build]");
  }
  return { arch: arch as TargetArchitecture, shouldSkipBuild: argumentList.includes("--skip-build") };
}

function run(
  command: string,
  commandArguments: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): string {
  const result = spawnSync(command, commandArguments, {
    cwd: options.cwd ?? projectRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) throw new Error(`${command} ${commandArguments.join(" ")} failed (${result.status})`);
  return result.stdout;
}

function hashFile(filePath: string, algorithm: "sha256" | "sha512", encoding: "hex" | "base64"): string {
  return createHash(algorithm).update(readFileSync(filePath)).digest(encoding);
}

/** The vendored Node tarball for `arch`, after checking it against the pinned SHA-256. */
function resolveNodeTarball(arch: TargetArchitecture): string {
  const tarballName = `node-v${NODE_VERSION}-linux-${arch}.tar.xz`;
  const vendorDirectory = path.join(projectRoot, "vendor", "node");
  const pinnedLine = readFileSync(path.join(vendorDirectory, "SHASUMS256.txt"), "utf8")
    .split("\n")
    .find((line) => line.trim().endsWith(`  ${tarballName}`));
  if (!pinnedLine) throw new Error(`vendor/node/SHASUMS256.txt has no checksum for ${tarballName}.`);
  const tarballPath = path.join(vendorDirectory, tarballName);
  if (!existsSync(tarballPath)) {
    throw new Error(
      `${path.relative(projectRoot, tarballPath)} is missing. Download it once on this build machine:\n` +
        `  curl -fLo vendor/node/${tarballName} https://nodejs.org/dist/v${NODE_VERSION}/${tarballName}`,
    );
  }
  const expectedHash = pinnedLine.split(/\s+/)[0];
  const actualHash = hashFile(tarballPath, "sha256", "hex");
  if (actualHash !== expectedHash)
    throw new Error(`${tarballName} does not match its pinned SHA-256 (got ${actualHash}).`);
  return tarballPath;
}

interface LockedPackage {
  version: string;
  integrity: string;
}

function readLockedPackage(packageName: string): LockedPackage {
  const lockfile = JSON.parse(readFileSync(path.join(projectRoot, "package-lock.json"), "utf8")) as {
    packages: Record<string, Partial<LockedPackage>>;
  };
  const lockedPackage = lockfile.packages[`node_modules/${packageName}`];
  if (!lockedPackage?.version || !lockedPackage.integrity)
    throw new Error(`package-lock.json does not pin ${packageName}.`);
  return { version: lockedPackage.version, integrity: lockedPackage.integrity };
}

/**
 * The target's argon2 package tarball from vendor/native, packed with `npm pack` the first time
 * (this machine's npm cache, or the registry once), and checked against package-lock.json.
 */
function resolveArgonTarball(arch: TargetArchitecture): {
  packageName: string;
  tarballPath: string;
  locked: LockedPackage;
} {
  const packageName = `@node-rs/argon2-linux-${arch}-gnu`;
  const locked = readLockedPackage(packageName);
  const nativeDirectory = path.join(projectRoot, "vendor", "native");
  const tarballPath = path.join(nativeDirectory, `node-rs-argon2-linux-${arch}-gnu-${locked.version}.tgz`);
  if (!existsSync(tarballPath)) {
    mkdirSync(nativeDirectory, { recursive: true });
    log(`packing ${packageName}@${locked.version} into vendor/native (build machine only)`);
    run("npm", ["pack", `${packageName}@${locked.version}`, "--pack-destination", nativeDirectory, "--silent"]);
  }
  const [algorithm, expectedDigest] = locked.integrity.split("-", 2) as [string, string];
  if (algorithm !== "sha512" || hashFile(tarballPath, "sha512", "base64") !== expectedDigest) {
    throw new Error(`${path.basename(tarballPath)} does not match the integrity in package-lock.json.`);
  }
  return { packageName, tarballPath, locked };
}

function listFilesRecursively(directory: string): string[] {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Keeps only what the target needs from dist/app's node_modules, and adds the target's argon2 package. */
function prepareNativeModules(
  applicationDirectory: string,
  arch: TargetArchitecture,
  argonTarball: string,
  argonPackage: string,
): void {
  const modulesDirectory = path.join(applicationDirectory, "node_modules");
  for (const unusedPackage of ["sharp", "@img"])
    rmSync(path.join(modulesDirectory, unusedPackage), { recursive: true, force: true });
  const prebuildsDirectory = path.join(modulesDirectory, "better-sqlite3", "prebuilds");
  for (const prebuild of readdirSync(prebuildsDirectory)) {
    if (prebuild !== `linux-${arch}.node`) rmSync(path.join(prebuildsDirectory, prebuild));
  }
  // node-pty ships prebuilds for macOS and Windows only; on Linux, npm ci compiles build/Release/pty.node.
  const ptyDirectory = path.join(modulesDirectory, "node-pty");
  if (!existsSync(path.join(ptyDirectory, "build", "Release", "pty.node")))
    throw new Error("node-pty has no build/Release/pty.node; build the package on Linux after npm ci.");
  const ptyPrebuildsDirectory = path.join(ptyDirectory, "prebuilds");
  for (const prebuild of existsSync(ptyPrebuildsDirectory) ? readdirSync(ptyPrebuildsDirectory) : []) {
    if (prebuild !== `linux-${arch}`) rmSync(path.join(ptyPrebuildsDirectory, prebuild), { recursive: true });
  }
  const scopeDirectory = path.join(modulesDirectory, "@node-rs");
  for (const scopedPackage of readdirSync(scopeDirectory)) {
    if (scopedPackage.startsWith("argon2-")) rmSync(path.join(scopeDirectory, scopedPackage), { recursive: true });
  }
  const argonDirectory = path.join(modulesDirectory, argonPackage);
  mkdirSync(argonDirectory, { recursive: true });
  run("tar", ["-xzf", argonTarball, "-C", argonDirectory, "--strip-components", "1"]);
}

/** Removes install hooks from every package.json: nothing in the package may run npm scripts (nothing runs npm anyway). */
function stripInstallScripts(applicationDirectory: string): number {
  let strippedCount = 0;
  for (const manifestPath of listFilesRecursively(path.join(applicationDirectory, "node_modules"))) {
    if (path.basename(manifestPath) !== "package.json") continue;
    let manifest: { scripts?: Record<string, string> };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
    } catch {
      continue;
    }
    const scriptNames = Object.keys(manifest.scripts ?? {}).filter((scriptName) =>
      INSTALL_SCRIPT_NAMES.includes(scriptName),
    );
    if (scriptNames.length === 0) continue;
    for (const scriptName of scriptNames) delete manifest.scripts?.[scriptName];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`);
    strippedCount += 1;
  }
  return strippedCount;
}

/** The ELF machine of a binary, or a description of what else it is. */
function readBinaryKind(filePath: string): number | string {
  const header = readFileSync(filePath).subarray(0, 20);
  if (header.readUInt32BE(0) !== 0x7f_45_4c_46) return `not ELF (magic ${header.subarray(0, 4).toString("hex")})`;
  return header.readUInt16LE(18);
}

function checkPackage(packageDirectory: string, arch: TargetArchitecture): void {
  const problems: string[] = [];
  const binaries = [
    path.join(packageDirectory, "node", "bin", "node"),
    ...listFilesRecursively(packageDirectory).filter((filePath) => filePath.endsWith(".node")),
  ];
  for (const binary of binaries) {
    const binaryKind = readBinaryKind(binary);
    if (binaryKind !== ELF_MACHINES[arch]) {
      problems.push(`${path.relative(packageDirectory, binary)} is not a Linux ${arch} binary (${binaryKind})`);
    }
  }
  for (const manifestPath of listFilesRecursively(path.join(packageDirectory, "app", "node_modules"))) {
    if (path.basename(manifestPath) !== "package.json") continue;
    const scripts =
      (JSON.parse(readFileSync(manifestPath, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
    if (INSTALL_SCRIPT_NAMES.some((scriptName) => scriptName in scripts)) {
      problems.push(`${path.relative(packageDirectory, manifestPath)} still has an install script`);
    }
  }
  if (problems.length > 0) throw new Error(`The package failed its checks:\n  - ${problems.join("\n  - ")}`);
  log(`checked ${binaries.length} native binaries (ELF ${arch}) and the package manifests`);
  const scanResult = spawnSync("npx", ["tsx", "scripts/check-offline-bundle.ts", "--package", packageDirectory], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (scanResult.status !== 0) throw new Error("the offline URL scan of the package failed");
}

/** tar.gz with root ownership and without macOS metadata or extended attributes (GNU tar warns about each one), plus `<name>.tar.gz.sha256` for `sha256sum -c`. */
function createTarball(packageDirectory: string): string {
  const parentDirectory = path.dirname(packageDirectory);
  const packageName = path.basename(packageDirectory);
  const tarballName = `${packageName}.tar.gz`;
  const isBsdTar = run("tar", ["--version"]).includes("bsdtar");
  const ownershipFlags = isBsdTar
    ? [
        "--uid",
        "0",
        "--gid",
        "0",
        "--uname",
        "root",
        "--gname",
        "root",
        "--no-mac-metadata",
        "--no-xattrs",
        "--no-acls",
      ]
    : ["--owner=0", "--group=0", "--numeric-owner"];
  run("tar", [...ownershipFlags, "-czf", tarballName, packageName], {
    cwd: parentDirectory,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  });
  const tarballPath = path.join(parentDirectory, tarballName);
  writeFileSync(`${tarballPath}.sha256`, `${hashFile(tarballPath, "sha256", "hex")}  ${tarballName}\n`);
  return tarballPath;
}

function copyExecutable(sourcePath: string, targetPath: string): void {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  chmodSync(targetPath, 0o755);
}

function packageServer(): void {
  const options = readOptions(process.argv.slice(2));
  const version = (JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { version: string })
    .version;
  const nodeTarball = resolveNodeTarball(options.arch);
  const argon = resolveArgonTarball(options.arch);
  if (!options.shouldSkipBuild) {
    log("npm run build");
    const buildResult = spawnSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "inherit" });
    if (buildResult.status !== 0) throw new Error(`npm run build failed (${buildResult.status})`);
  }
  const builtApplication = path.join(projectRoot, "dist", "app");
  for (const requiredFile of ["entry.js", "cli.js", "server.js", "migrations"]) {
    if (!existsSync(path.join(builtApplication, requiredFile)))
      throw new Error(`dist/app/${requiredFile} is missing; run without --skip-build.`);
  }

  const packageName = `cmm-server-${version}-linux-${options.arch}`;
  const packageDirectory = path.join(projectRoot, "dist", packageName);
  rmSync(packageDirectory, { recursive: true, force: true });
  rmSync(`${packageDirectory}.tar.gz`, { force: true });
  rmSync(`${packageDirectory}.tar.gz.sha256`, { force: true });

  const applicationDirectory = path.join(packageDirectory, "app");
  cpSync(builtApplication, applicationDirectory, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (sourcePath) => !sourcePath.endsWith(".map") && path.basename(sourcePath) !== "tsconfig.json",
  });
  prepareNativeModules(applicationDirectory, options.arch, argon.tarballPath, argon.packageName);
  const strippedCount = stripInstallScripts(applicationDirectory);
  log(`app/ ready (${strippedCount} install scripts removed from package.json files)`);

  const extractDirectory = mkdtempSync(path.join(tmpdir(), "cmm-node-"));
  try {
    run("tar", ["-xJf", nodeTarball, "-C", extractDirectory]);
    const nodeRoot = path.join(extractDirectory, `node-v${NODE_VERSION}-linux-${options.arch}`);
    copyExecutable(path.join(nodeRoot, "bin", "node"), path.join(packageDirectory, "node", "bin", "node"));
    copyFileSync(path.join(nodeRoot, "LICENSE"), path.join(packageDirectory, "node", "LICENSE"));
  } finally {
    rmSync(extractDirectory, { recursive: true, force: true });
  }
  log(`node/ ready (Node ${NODE_VERSION} linux-${options.arch}; npm and corepack left out)`);

  const deploySource = path.join(projectRoot, "deploy", "linux");
  copyExecutable(path.join(deploySource, "cmm"), path.join(packageDirectory, "bin", "cmm"));
  copyExecutable(path.join(deploySource, "install.sh"), path.join(packageDirectory, "install.sh"));
  copyExecutable(path.join(deploySource, "uninstall.sh"), path.join(packageDirectory, "uninstall.sh"));
  mkdirSync(path.join(packageDirectory, "deploy"));
  for (const deployFile of [
    "cmm.service",
    "50-cmm-udisks.rules",
    "50-cmm-udisks.pkla",
    "config.example.json",
    "Caddyfile.example",
  ]) {
    copyFileSync(path.join(deploySource, deployFile), path.join(packageDirectory, "deploy", deployFile));
  }
  copyFileSync(path.join(deploySource, "README-INSTALL.txt"), path.join(packageDirectory, "README-INSTALL.txt"));
  writeFileSync(path.join(packageDirectory, "VERSION"), `${version}\n`);
  writeFileSync(path.join(packageDirectory, "ARCH"), `${options.arch}\n`);

  const guidePath = path.join(projectRoot, "dist", "docs", "CMM-Server-Guide.pdf");
  if (existsSync(guidePath)) {
    mkdirSync(path.join(packageDirectory, "docs"));
    copyFileSync(guidePath, path.join(packageDirectory, "docs", "CMM-Server-Guide.pdf"));
  } else {
    log("no dist/docs/CMM-Server-Guide.pdf yet (`npm run docs:pdf` builds it); the package ships without docs/");
  }

  const gitCommit = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).stdout.trim();
  writeFileSync(
    path.join(packageDirectory, "BUILD-INFO.txt"),
    [
      `CMM server ${version} for linux-${options.arch}`,
      `Built: ${new Date().toISOString()} on ${process.platform}-${process.arch}${gitCommit ? ` from commit ${gitCommit}` : ""}`,
      `Node runtime: ${path.basename(nodeTarball)} (SHA-256 ${hashFile(nodeTarball, "sha256", "hex")})`,
      "Native modules: N-API prebuilds, nothing compiled.",
      `  better-sqlite3: prebuilds/linux-${options.arch}.node from its npm package`,
      `  ${argon.packageName}@${argon.locked.version}: ${argon.locked.integrity} (package-lock.json)`,
      "",
    ].join("\n"),
  );

  checkPackage(packageDirectory, options.arch);
  const tarballPath = createTarball(packageDirectory);
  const megabytes = (statSync(tarballPath).size / 1024 / 1024).toFixed(1);
  log(`wrote ${path.relative(projectRoot, tarballPath)} (${megabytes} MB) and its .sha256`);
}

try {
  packageServer();
} catch (packageError) {
  console.error(`[package-server] ${packageError instanceof Error ? packageError.message : String(packageError)}`);
  process.exit(1);
}
