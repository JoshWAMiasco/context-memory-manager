"use client";

import type { FileEntry } from "@/lib/api-types";
import { buildFolderUploadResource } from "@/lib/auth/policy";
import { ApiError, requestJson } from "@/lib/client/api";
import { joinEntryPath } from "@/lib/client/query-keys";
import { requestStepUpGrant } from "@/lib/client/step-up";
import { getUploadQueue } from "@/lib/client/upload-queue";

/** A file of a folder upload, with its folder relative to where the upload goes ("" at the top). */
export interface FolderUploadFile {
  file: File;
  relativeDirectory: string;
}

/** What was dropped or picked: files with their folders, and every folder (empty ones too). */
export interface FolderTree {
  files: FolderUploadFile[];
  /** Folders relative to where the upload goes, parents before children. */
  directories: string[];
}

/** Operating-system clutter a folder upload leaves out. */
const JUNK_FILE_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini", ".localized"]);

/**
 * Whether a path of a folder upload is OS clutter or a git repository's internals, which a folder
 * upload leaves out: `.DS_Store`, `Thumbs.db`, `desktop.ini`, macOS `._*` files, and anything
 * inside `.git/`.
 *
 * @example
 * isJunkPath("project/.git/config"); // true
 * isJunkPath("project/notes.md"); // false
 */
export function isJunkPath(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  const name = segments.at(-1)?.toLowerCase() ?? "";
  return segments.includes(".git") || JUNK_FILE_NAMES.has(name) || name.startsWith("._");
}

function readAllEntries(directoryReader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = [];
    // readEntries returns at most ~100 entries a call; it is called until it returns none.
    const readBatch = () =>
      directoryReader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(entries);
          return;
        }
        entries.push(...batch);
        readBatch();
      }, reject);
    readBatch();
  });
}

function readEntryFile(fileEntry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => fileEntry.file(resolve, reject));
}

/**
 * The entries of an OS drop. Call it inside the drop event: the browser forgets them afterwards.
 * Then read them with `readDroppedTree`.
 *
 * @example
 * const dropped = captureDroppedEntries(dropEvent.dataTransfer);
 * const tree = await readDroppedTree(dropped);
 */
export function captureDroppedEntries(dataTransfer: DataTransfer): (FileSystemEntry | File)[] {
  const items = [...dataTransfer.items].filter((item) => item.kind === "file");
  if (items.length === 0) return [...dataTransfer.files];
  return items.flatMap((item) => item.webkitGetAsEntry?.() ?? item.getAsFile() ?? []);
}

/**
 * Reads dropped files and folders into a tree: each folder's files and subfolders, however deep.
 *
 * @example
 * const { files, directories } = await readDroppedTree(captureDroppedEntries(dataTransfer));
 */
export async function readDroppedTree(dropped: readonly (FileSystemEntry | File)[]): Promise<FolderTree> {
  const tree: FolderTree = { files: [], directories: [] };
  const visit = async (entry: FileSystemEntry, parentDirectory: string): Promise<void> => {
    if (entry.isFile) {
      tree.files.push({ file: await readEntryFile(entry as FileSystemFileEntry), relativeDirectory: parentDirectory });
      return;
    }
    if (!entry.isDirectory) return;
    const directory = joinEntryPath(parentDirectory, entry.name);
    tree.directories.push(directory);
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await visit(child, directory);
  };
  for (const droppedItem of dropped) {
    if (droppedItem instanceof File) tree.files.push({ file: droppedItem, relativeDirectory: "" });
    else await visit(droppedItem, "");
  }
  return tree;
}

/**
 * The tree of files picked with a folder picker (`<input webkitdirectory>`), from each file's
 * `webkitRelativePath` ("Project/docs/a.md").
 *
 * @example
 * const tree = readPickedFolder(inputElement.files);
 */
export function readPickedFolder(files: readonly File[]): FolderTree {
  const tree: FolderTree = { files: [], directories: [] };
  const directories = new Set<string>();
  for (const file of files) {
    const segments = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
    const relativeDirectory = segments.slice(0, -1).join("/");
    for (let depth = 1; depth <= segments.length - 1; depth += 1) directories.add(segments.slice(0, depth).join("/"));
    tree.files.push({ file, relativeDirectory });
  }
  tree.directories = [...directories].toSorted((first, second) => first.split("/").length - second.split("/").length);
  return tree;
}

/** A tree without OS clutter and `.git/`, and how many items were left out. */
export function withoutJunk(tree: FolderTree): FolderTree & { skippedCount: number } {
  const files = tree.files.filter(
    ({ file, relativeDirectory }) => !isJunkPath(joinEntryPath(relativeDirectory, file.name)),
  );
  const directories = tree.directories.filter((directory) => !isJunkPath(directory));
  return {
    files,
    directories,
    skippedCount: tree.files.length - files.length + tree.directories.length - directories.length,
  };
}

/**
 * Uploads a folder tree into `folderPath`: asks for the `upload` confirmation once for the whole
 * folder (where the server wants one), recreates its folders (an existing folder is merged into),
 * then queues every file as one batch, so a name clash can be answered for all of them. OS clutter
 * and `.git/` are left out. Resolves to what was queued and skipped, or undefined when the
 * confirmation is cancelled.
 *
 * @example
 * await startFolderUpload(tree, "home", "notes");
 */
export async function startFolderUpload(
  tree: FolderTree,
  storageId: string,
  folderPath: string,
): Promise<{ queuedCount: number; skippedCount: number } | undefined> {
  const { files, directories, skippedCount } = withoutJunk(tree);
  if (files.length === 0 && directories.length === 0) return { queuedCount: 0, skippedCount };
  const grant = await requestStepUpGrant("upload", buildFolderUploadResource(storageId, folderPath));
  if (!grant) return undefined;
  for (const directory of directories) {
    try {
      await requestJson<{ entry: FileEntry }>("/api/fs/mkdir", {
        method: "POST",
        body: { storageId, path: joinEntryPath(folderPath, directory) },
      });
    } catch (mkdirError) {
      if (!(mkdirError instanceof ApiError) || mkdirError.code !== "ALREADY_EXISTS") throw mkdirError;
    }
  }
  getUploadQueue().addTree(
    files.map(({ file, relativeDirectory }) => ({ file, directory: joinEntryPath(folderPath, relativeDirectory) })),
    storageId,
    { root: folderPath, actionToken: grant.actionToken },
  );
  return { queuedCount: files.length, skippedCount };
}

/**
 * Uploads files picked or dropped together into `folderPath`. Several files ask for the `upload`
 * confirmation once, for the folder (where the server wants one), instead of once per file; one
 * file asks as it starts. Resolves to whether they were queued (false when the confirmation is
 * cancelled).
 *
 * @example
 * await startFilesUpload([...input.files], "home", "notes");
 */
export async function startFilesUpload(
  files: readonly File[],
  storageId: string,
  folderPath: string,
): Promise<boolean> {
  if (files.length === 0) return true;
  if (files.length === 1) {
    getUploadQueue().add(files, storageId, folderPath);
    return true;
  }
  const grant = await requestStepUpGrant("upload", buildFolderUploadResource(storageId, folderPath));
  if (!grant) return false;
  getUploadQueue().add(files, storageId, folderPath, { root: folderPath, actionToken: grant.actionToken });
  return true;
}
