import "server-only";
import path from "node:path";
import type { Readable, Transform } from "node:stream";
import type { UserRole } from "@/lib/auth/policy";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

export type FileOperationType =
  "read" | "write" | "create" | "mkdir" | "rename" | "move" | "copy" | "delete" | "restore" | "list" | "stat";

/** Who runs an operation (the user's id and role). `sessionIdHash` is absent for background jobs and services. */
export interface FileActor {
  id: string;
  username?: string;
  role: UserRole;
  sessionIdHash?: string;
}

export interface FileOperationTarget {
  storageId: string;
  /** Storage-relative POSIX path. */
  path: string;
  absolutePath: string;
}

/** One file system operation as guards, transforms and after-hooks see it. */
export interface FileOperation extends FileOperationTarget {
  type: FileOperationType;
  actor: FileActor;
  /** The second path of rename, move and copy. */
  destination?: FileOperationTarget;
  isDirectory?: boolean;
  /** The user confirmed that moving or copying out of an encrypted folder leaves plaintext. */
  confirmDecrypt?: boolean;
  /** Read the bytes as stored on disk, skipping decryption ("Encrypted (raw)" downloads). */
  asStored?: boolean;
  /**
   * How the change arrived, when it matters to after-hooks ("Upload 3 files" commits): an upload,
   * or a file replaced by one from the user's computer.
   */
  origin?: "upload" | "replace";
}

/** The storage root of an operation target: its absolute path minus its storage-relative path. */
export function readOperationRoot(target: FileOperationTarget): string {
  if (target.path === "") return target.absolutePath;
  return path.resolve(target.absolutePath, ...target.path.split("/").map(() => ".."));
}

/**
 * Encrypts an upload's chunks as they arrive, so a partly received upload is never plaintext
 * on disk. The part file starts with `startBytes`; `received` says how much of the plaintext the
 * part already holds (whole chunks only) and how long the part should be.
 */
export interface UploadCipher {
  startBytes: () => Buffer;
  received: (partBytes: number, totalSize: number) => { plainBytes: number; partBytes: number };
  /** Encrypts the next request's bytes; `partStart` is the part's first bytes, `plainOffset` where they continue. */
  createAppender: (partStart: Buffer, plainOffset: number, totalSize: number) => Transform;
  /** Authenticates a complete part before it is put in place. */
  verify: (partPath: string) => Promise<void>;
}

/** Runs before an operation; throws an `ApiRouteError` to stop it (protection, encryption). */
export type FileOperationGuard = (operation: FileOperation) => void | Promise<void>;

/** Wraps file content streams; returns undefined to leave the stream alone (encryption). */
export interface FileTransform {
  read?: (operation: FileOperation) => Transform | undefined | Promise<Transform | undefined>;
  write?: (operation: FileOperation) => Transform | undefined | Promise<Transform | undefined>;
  /** Serves a byte range of the transformed content (range requests on encrypted files). */
  readRange?: (operation: FileOperation, range: { start: number; end: number }) => Promise<Readable | undefined>;
  /**
   * The content transforms of one file copied or moved from `operation` to `operation.destination`;
   * when present it replaces `read` + `write` (encryption copies ciphertext as it is within one key).
   */
  transfer?: (operation: FileOperation) => Promise<Transform[] | undefined>;
  /** True when a move can't be a plain rename because content must change on the way. */
  blocksRename?: (operation: FileOperation) => Promise<boolean>;
  /** Checks a written temporary file before it replaces the target (encryption authenticates the ciphertext). */
  verifyWrite?: (operation: FileOperation, temporaryPath: string) => Promise<void>;
  upload?: (operation: FileOperation) => Promise<UploadCipher | undefined>;
}

/** Runs after an operation succeeded (versioning). Failures are logged, never thrown. */
export type FileOperationAfterHook = (operation: FileOperation) => void | Promise<void>;

interface PipelineRegistry {
  guards: Map<string, FileOperationGuard>;
  transforms: Map<string, FileTransform>;
  afterHooks: Map<string, FileOperationAfterHook>;
}

/*
 * Hooks are registered by name, so a module that runs twice (the entry bundle and Next's chunks
 * each load their own copy) replaces its hook instead of adding a second one.
 */
function getRegistry(): PipelineRegistry {
  return getGlobalSingleton("fs-pipeline", () => ({
    guards: new Map(),
    transforms: new Map(),
    afterHooks: new Map(),
  }));
}

export function registerGuard(hookName: string, guard: FileOperationGuard): void {
  getRegistry().guards.set(hookName, guard);
}

export function registerTransform(hookName: string, transform: FileTransform): void {
  getRegistry().transforms.set(hookName, transform);
}

export function registerAfter(hookName: string, afterHook: FileOperationAfterHook): void {
  getRegistry().afterHooks.set(hookName, afterHook);
}

/** Removes a hook of any kind; tests use it to restore the registry. */
export function unregisterHook(hookName: string): void {
  const registry = getRegistry();
  registry.guards.delete(hookName);
  registry.transforms.delete(hookName);
  registry.afterHooks.delete(hookName);
}

/** Runs every guard in registration order; the first to throw stops the operation. */
export async function runGuards(operation: FileOperation): Promise<void> {
  for (const guard of getRegistry().guards.values()) await guard(operation);
}

/** The read or write transforms that apply to `operation`, in registration order. */
export async function collectTransforms(direction: "read" | "write", operation: FileOperation): Promise<Transform[]> {
  const transforms: Transform[] = [];
  for (const fileTransform of getRegistry().transforms.values()) {
    const transform = await fileTransform[direction]?.(operation);
    if (transform) transforms.push(transform);
  }
  return transforms;
}

/** The first transform's stream of a byte range, or undefined when no transform serves ranges here. */
export async function openTransformedRange(
  operation: FileOperation,
  range: { start: number; end: number },
): Promise<Readable | undefined> {
  for (const fileTransform of getRegistry().transforms.values()) {
    const stream = await fileTransform.readRange?.(operation, range);
    if (stream) return stream;
  }
  return undefined;
}

/**
 * The transforms for copying one file's content from `operation` (type copy or move, with a
 * destination): each hook's `transfer`, or its `read` at the source then `write` at the destination.
 */
export async function collectTransferTransforms(operation: FileOperation): Promise<Transform[]> {
  const destination = operation.destination;
  if (!destination) throw new Error("A transfer needs a destination.");
  const transforms: Transform[] = [];
  for (const fileTransform of getRegistry().transforms.values()) {
    if (fileTransform.transfer) {
      transforms.push(...((await fileTransform.transfer(operation)) ?? []));
      continue;
    }
    const readTransform = await fileTransform.read?.({ ...operation, type: "read", destination: undefined });
    const writeTransform = await fileTransform.write?.({ ...operation, ...destination, type: "write" });
    if (readTransform) transforms.push(readTransform);
    if (writeTransform) transforms.push(writeTransform);
  }
  return transforms;
}

/** Whether a move must copy content through transforms instead of renaming. */
export async function requiresContentCopy(operation: FileOperation): Promise<boolean> {
  for (const fileTransform of getRegistry().transforms.values()) {
    if (await fileTransform.blocksRename?.(operation)) return true;
  }
  return false;
}

/** Runs every `verifyWrite` hook on a written temporary file. */
export async function verifyWrittenFile(operation: FileOperation, temporaryPath: string): Promise<void> {
  for (const fileTransform of getRegistry().transforms.values())
    await fileTransform.verifyWrite?.(operation, temporaryPath);
}

/** The cipher that encrypts an upload to `operation`'s target as it arrives, if any. */
export async function collectUploadCipher(operation: FileOperation): Promise<UploadCipher | undefined> {
  for (const fileTransform of getRegistry().transforms.values()) {
    const cipher = await fileTransform.upload?.(operation);
    if (cipher) return cipher;
  }
  return undefined;
}

/** Runs every after-hook; a failing hook is logged and does not undo the operation. */
export async function runAfterHooks(operation: FileOperation): Promise<void> {
  for (const [hookName, afterHook] of getRegistry().afterHooks) {
    try {
      await afterHook(operation);
    } catch (hookError) {
      console.error(`[cmm] after-hook "${hookName}" failed for ${operation.type} ${operation.path}`, hookError);
    }
  }
}
