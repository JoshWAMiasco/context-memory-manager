import "server-only";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { pipeline as connectStreams, type Readable } from "node:stream";
import archiver from "archiver";
import type { DownloadMeasurement } from "@/lib/api-types";
import { readFileHeader } from "@/server/crypto/format";
import { validationFailed } from "@/server/http/api-error";
import { resolveInStorage, type ResolvedPath } from "@/server/security/path-jail";
import { walkTree } from "@/server/storage/copy-tree";
import { collectTransforms, runGuards, type FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";

/** At most this many items in one "download the selection" zip. */
export const MAX_ZIP_ITEMS = 500;

/** One selected item of a zip: where it is, and the name it gets at the top of the zip ("" for a lone folder). */
interface ZipRoot {
  resolved: ResolvedPath;
  isDirectory: boolean;
  zipName: string;
}

/** "name (2).ext" for the second selected item with the same name (from different folders). */
function readUniqueZipName(name: string, isDirectory: boolean, takenNames: Set<string>): string {
  const dotIndex = name.lastIndexOf(".");
  const [stem, extension] = isDirectory || dotIndex <= 0 ? [name, ""] : [name.slice(0, dotIndex), name.slice(dotIndex)];
  let candidate = name;
  for (let attempt = 2; takenNames.has(candidate.toLowerCase()); attempt += 1) candidate = `${stem} (${attempt})${extension}`;
  takenNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * The selected items, resolved and checked (read guards): a single folder's zip holds its
 * contents; several items each get a top-level entry named after them.
 */
async function resolveZipRoots(storage: ActiveStorage, relativePaths: readonly string[], actor: FileActor): Promise<ZipRoot[]> {
  if (relativePaths.length === 0) throw validationFailed("Choose something to download.");
  if (relativePaths.length > MAX_ZIP_ITEMS) throw validationFailed(`Download at most ${MAX_ZIP_ITEMS} items at once.`);
  const takenNames = new Set<string>();
  const roots: ZipRoot[] = [];
  for (const relativePath of relativePaths) {
    const resolved = await resolveInStorage(storage, relativePath);
    const isDirectory = (await lstat(resolved.absolutePath)).isDirectory();
    await runGuards({
      type: "read",
      storageId: storage.id,
      path: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      actor,
      isDirectory,
    });
    const name = resolved.relativePath === "" ? storage.label : path.basename(resolved.absolutePath);
    const isLoneFolder = relativePaths.length === 1 && isDirectory;
    roots.push({ resolved, isDirectory, zipName: isLoneFolder ? "" : readUniqueZipName(name, isDirectory, takenNames) });
  }
  return roots;
}

function joinZipName(prefix: string, relativePath: string): string {
  return prefix === "" ? relativePath : relativePath === "" ? prefix : `${prefix}/${relativePath}`;
}

/** Every file and folder a zip of `roots` holds, as the walk sees them. */
async function* walkZipRoots(roots: readonly ZipRoot[]) {
  for (const root of roots) {
    for await (const treeEntry of walkTree(root.resolved.absolutePath, { skipMetadata: true })) {
      if (treeEntry.type === "symlink" || treeEntry.isSpecial) continue;
      if (treeEntry.relativePath === "" && root.isDirectory && root.zipName === "") continue;
      const storagePath =
        treeEntry.relativePath === ""
          ? root.resolved.relativePath
          : joinZipName(root.resolved.relativePath, treeEntry.relativePath);
      yield { treeEntry, zipPath: joinZipName(root.zipName, treeEntry.relativePath), storagePath };
    }
  }
}

/**
 * What a zip of these items will hold, for the confirmation before downloading it: how many
 * files and bytes, and how many files are encrypted (they are decrypted into the zip).
 *
 * @example
 * const { fileCount, totalBytes, encryptedFileCount } = await measureZipDownload(storage, ["notes"], actor);
 */
export async function measureZipDownload(
  storage: ActiveStorage,
  relativePaths: readonly string[],
  actor: FileActor,
): Promise<DownloadMeasurement> {
  const roots = await resolveZipRoots(storage, relativePaths, actor);
  const measurement: DownloadMeasurement = { fileCount: 0, totalBytes: 0, encryptedFileCount: 0 };
  for await (const { treeEntry } of walkZipRoots(roots)) {
    if (treeEntry.type !== "file") continue;
    measurement.fileCount += 1;
    measurement.totalBytes += treeEntry.size;
    if ((await readFileHeader(treeEntry.absolutePath)) !== undefined) measurement.encryptedFileCount += 1;
  }
  return measurement;
}

/**
 * Streams a folder, or several selected files and folders, as a zip. A lone folder's zip holds its
 * contents; several items each get a top-level entry (same names get " (2)"). `.cmm/`,
 * `.cmm-trash/`, `.cmm-tmp/` and `.git` are left out, symlinks are skipped, and file content passes
 * the read transforms (decrypting encrypted files). Entries are added one at a time, so only one
 * file is open however big the folder is, and a slow download slows the walk instead of buffering.
 */
export async function createZipStream(
  storage: ActiveStorage,
  relativePaths: readonly string[],
  actor: FileActor,
): Promise<Readable> {
  const roots = await resolveZipRoots(storage, relativePaths, actor);
  const archive = archiver("zip", { zlib: { level: 6 } });
  const addEntries = async () => {
    for await (const { treeEntry, zipPath, storagePath } of walkZipRoots(roots)) {
      if (treeEntry.type === "directory") {
        archive.append(Buffer.alloc(0), { name: `${zipPath}/`, date: new Date(treeEntry.mtimeMs) });
        continue;
      }
      const transforms = await collectTransforms("read", {
        type: "read",
        storageId: storage.id,
        path: storagePath,
        absolutePath: treeEntry.absolutePath,
        actor,
      });
      const contentStream = transforms.reduce<Readable>(
        (previousStream, transform) => connectStreams(previousStream, transform, () => undefined),
        createReadStream(treeEntry.absolutePath),
      );
      const entryAdded = once(archive, "entry");
      archive.append(contentStream, { name: zipPath, date: new Date(treeEntry.mtimeMs) });
      await entryAdded;
    }
    await archive.finalize();
  };
  addEntries().catch((zipError: unknown) => {
    console.error("[cmm] zip download failed", zipError);
    archive.abort();
    archive.destroy(zipError as Error);
  });
  return archive;
}

/** Streams a folder as a zip of its contents (see `createZipStream`). */
export function createFolderZipStream(storage: ActiveStorage, relativePath: string, actor: FileActor): Promise<Readable> {
  return createZipStream(storage, [relativePath], actor);
}
