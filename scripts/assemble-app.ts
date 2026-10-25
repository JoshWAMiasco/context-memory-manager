/*
 * Assembles dist/app: the self-contained server that desktop and server packaging ship.
 *
 *   dist/app/entry.js       the bundled entry (runs migrations, binds, hands requests to Next)
 *   dist/app/cli.js         the bundled `cmm` admin CLI (server installs)
 *   dist/app/server.js …    the Next standalone output, with its traced node_modules
 *   dist/app/.next/static   client assets
 *   dist/app/public         public files
 *   dist/app/migrations     SQL migrations
 *   dist/app/content        help texts read at run time (the offline Git install notes)
 *
 * The entry bundle keeps native and Node-only packages external (see build-entry.ts). Next's
 * standalone trace only includes the files Next's own chunks load (often the ESM build), so the
 * entry and the CLI are traced separately with @vercel/nft and the files they `require` are copied in too.
 * node-pty (terminals) finds its native binary by a computed path the tracer can't follow, so it
 * is copied whole.
 */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

interface FileTraceResult {
  fileList: Set<string>;
}

/** Next's bundled copy of @vercel/nft (untyped), the tracer Next uses for its own standalone output. */
const NFT_MODULE = "next/dist/compiled/@vercel/nft";

type NodeFileTrace = (files: string[], options: { base: string; ignore: string[] }) => Promise<FileTraceResult>;

const projectRoot = path.resolve(__dirname, "..");
const applicationDirectory = path.join(projectRoot, "dist", "app");

function copyDirectory(sourceDirectory: string, targetDirectory: string): void {
  if (!existsSync(sourceDirectory)) return;
  cpSync(sourceDirectory, targetDirectory, { recursive: true, verbatimSymlinks: true });
}

rmSync(applicationDirectory, { recursive: true, force: true });
copyDirectory(path.join(projectRoot, ".next", "standalone"), applicationDirectory);
// The tracer can pick up tsconfig.json files from earlier build output (dist/desktop); none of dist/ belongs here.
rmSync(path.join(applicationDirectory, "dist"), { recursive: true, force: true });
copyDirectory(path.join(projectRoot, ".next", "static"), path.join(applicationDirectory, ".next", "static"));
copyDirectory(path.join(projectRoot, "public"), path.join(applicationDirectory, "public"));
copyDirectory(path.join(projectRoot, "server", "db", "migrations"), path.join(applicationDirectory, "migrations"));
copyDirectory(path.join(projectRoot, "content"), path.join(applicationDirectory, "content"));
copyFileSync(path.join(projectRoot, "dist", "server", "entry.js"), path.join(applicationDirectory, "entry.js"));
copyFileSync(path.join(projectRoot, "dist", "server", "entry.js.map"), path.join(applicationDirectory, "entry.js.map"));
copyFileSync(path.join(projectRoot, "dist", "cli", "cmm.js"), path.join(applicationDirectory, "cli.js"));
copyFileSync(path.join(projectRoot, "dist", "cli", "cmm.js.map"), path.join(applicationDirectory, "cli.js.map"));
copyNodePty();

/**
 * Copies node-pty's JavaScript, its license and its native files: the prebuilds (macOS, Windows)
 * or the binary built at install (Linux). Its `spawn-helper` must be executable, and node-pty
 * 1.1.0's prebuilds ship it without that bit; a signed app can't fix it at run time.
 */
function copyNodePty(): void {
  const sourceDirectory = path.join(projectRoot, "node_modules", "node-pty");
  const targetDirectory = path.join(applicationDirectory, "node_modules", "node-pty");
  rmSync(targetDirectory, { recursive: true, force: true });
  for (const entryName of ["package.json", "LICENSE", "lib", "prebuilds", path.join("build", "Release")]) {
    const sourcePath = path.join(sourceDirectory, entryName);
    if (existsSync(sourcePath)) cpSync(sourcePath, path.join(targetDirectory, entryName), { recursive: true });
  }
  for (const nativeDirectory of [
    path.join(targetDirectory, "build", "Release"),
    path.join(targetDirectory, "prebuilds"),
  ]) {
    if (!existsSync(nativeDirectory)) continue;
    for (const entry of readdirSync(nativeDirectory, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name === "spawn-helper") chmodSync(path.join(entry.parentPath, entry.name), 0o755);
    }
  }
}

async function copyEntryDependencies(): Promise<number> {
  const { nodeFileTrace } = (await import(NFT_MODULE)) as { nodeFileTrace: NodeFileTrace };
  const { fileList } = await nodeFileTrace(
    [path.join("dist", "server", "entry.js"), path.join("dist", "cli", "cmm.js")],
    {
      base: projectRoot,
      ignore: ["node_modules/next/**"],
    },
  );
  let copiedCount = 0;
  for (const tracedFile of fileList) {
    if (!tracedFile.startsWith("node_modules/")) continue;
    const targetPath = path.join(applicationDirectory, tracedFile);
    if (existsSync(targetPath)) continue;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(path.join(projectRoot, tracedFile), targetPath);
    copiedCount += 1;
  }
  return copiedCount;
}

copyEntryDependencies()
  .then((copiedCount) => {
    console.log(
      `[assemble-app] wrote ${path.relative(projectRoot, applicationDirectory)} (${copiedCount} entry dependency files added)`,
    );
  })
  .catch((assembleError: unknown) => {
    console.error(assembleError);
    process.exit(1);
  });
