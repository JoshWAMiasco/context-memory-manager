import "server-only";
import path from "node:path";
import { effectiveState, type EffectiveProtection } from "@/server/meta/effective";
import { ApiRouteError } from "@/server/http/api-error";
import { findProtectedInside } from "@/server/protection/scopes";
import {
  readOperationRoot,
  registerGuard,
  type FileOperation,
  type FileOperationTarget,
} from "@/server/storage/pipeline";

export const PROTECTION_GUARD_NAME = "protection";

function rejectProtected(protection: EffectiveProtection, verb: string): never {
  const isLocked = protection.mode === "locked";
  const subject = protection.source?.path ? `"${path.posix.basename(protection.source.path)}"` : "This storage";
  const where = `${subject} is ${isLocked ? "locked" : "view-only"}`;
  throw new ApiRouteError(
    403,
    isLocked ? "PROTECTED_LOCKED" : "PROTECTED_VIEW_ONLY",
    `${where}, so it can't be ${verb}. Change its protection in Folder settings first.`,
    { mode: protection.mode, source: protection.source?.path ?? "" },
  );
}

async function requireUnprotected(target: FileOperationTarget, verb: string, isDirectory?: boolean): Promise<void> {
  const { protection } = await effectiveState(readOperationRoot(target), target.path, { isDirectory });
  if (protection.mode !== "none") rejectProtected(protection, verb);
}

/** Deleting, moving or renaming a folder would take protected items inside it along. */
function requireNothingProtectedInside(operation: FileOperation, verb: string): void {
  if (operation.isDirectory === false) return;
  const protectedRows = findProtectedInside(operation.storageId, operation.path);
  const firstRow = protectedRows[0];
  if (!firstRow) return;
  throw new ApiRouteError(
    403,
    "CONTAINS_PROTECTED",
    `This folder contains protected items ("${firstRow.path}"${protectedRows.length > 1 ? ` and ${protectedRows.length - 1} more` : ""}), so it can't be ${verb}. Remove their protection first.`,
    { paths: protectedRows.map((row) => row.path) },
  );
}

/**
 * Stops changes to protected entries. Changing anything inside a view-only or locked
 * folder or file (write, create, new folder, rename, move in or out, delete, restore, upload) is
 * refused with 403 `PROTECTED_VIEW_ONLY` or `PROTECTED_LOCKED`; deleting, moving or renaming a
 * folder with protected items inside is refused with 403 `CONTAINS_PROTECTED`. Reading, listing,
 * downloading and copying out are allowed.
 *
 * @example
 * await protectionGuard({ type: "delete", storageId, path: "notes/a.md", absolutePath, actor });
 */
export async function protectionGuard(operation: FileOperation): Promise<void> {
  switch (operation.type) {
    case "write":
      return requireUnprotected(operation, "changed", false);
    case "create":
    case "mkdir":
      return requireUnprotected(operation, "changed", operation.isDirectory);
    case "delete":
      await requireUnprotected(operation, "deleted", operation.isDirectory);
      return requireNothingProtectedInside(operation, "deleted");
    case "rename":
    case "move":
      await requireUnprotected(operation, operation.type === "rename" ? "renamed" : "moved", operation.isDirectory);
      requireNothingProtectedInside(operation, operation.type === "rename" ? "renamed" : "moved");
      if (operation.destination) await requireUnprotected(operation.destination, "changed");
      return;
    case "copy":
      if (operation.destination) await requireUnprotected(operation.destination, "changed");
      return;
    case "restore":
      return requireUnprotected(operation, "changed", operation.isDirectory);
    default:
      return;
  }
}

/** Registers the protection guard in the file operation pipeline (idempotent). */
export function registerProtectionGuard(): void {
  registerGuard(PROTECTION_GUARD_NAME, protectionGuard);
}
