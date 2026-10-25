import "server-only";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { pipeline as connectStreams, type Readable } from "node:stream";
import archiver from "archiver";
import { resolveInStorage } from "@/server/security/path-jail";
import { walkTree } from "@/server/storage/copy-tree";
import { collectTransforms, runGuards, type FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";

/**
 * Streams a folder as a zip. `.cmm/`, `.cmm-trash/`, `.cmm-tmp/` and `.git` are left
 * out, symlinks are skipped, and file content passes the read transforms (decrypting encrypted files). Entries
 * are added one at a time, so only one file is open however big the folder is, and a slow
 * download slows the walk instead of buffering.
 */
export async function createFolderZipStream(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
): Promise<Readable> {
  const folder = await resolveInStorage(storage, relativePath);
  await runGuards({
    type: "read",
    storageId: storage.id,
    path: folder.relativePath,
    absolutePath: folder.absolutePath,
    actor,
    isDirectory: true,
  });
  const archive = archiver("zip", { zlib: { level: 6 } });
  const addEntries = async () => {
    for await (const treeEntry of walkTree(folder.absolutePath, { skipMetadata: true })) {
      if (treeEntry.relativePath === "" || treeEntry.type === "symlink") continue;
      if (treeEntry.type === "directory") {
        archive.append(Buffer.alloc(0), { name: `${treeEntry.relativePath}/`, date: new Date(treeEntry.mtimeMs) });
        continue;
      }
      const transforms = await collectTransforms("read", {
        type: "read",
        storageId: storage.id,
        path: folder.relativePath === "" ? treeEntry.relativePath : `${folder.relativePath}/${treeEntry.relativePath}`,
        absolutePath: treeEntry.absolutePath,
        actor,
      });
      const contentStream = transforms.reduce<Readable>(
        (previousStream, transform) => connectStreams(previousStream, transform, () => undefined),
        createReadStream(treeEntry.absolutePath),
      );
      const entryAdded = once(archive, "entry");
      archive.append(contentStream, { name: treeEntry.relativePath, date: new Date(treeEntry.mtimeMs) });
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
