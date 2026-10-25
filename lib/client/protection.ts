import type { FileBadges, FileEntry } from "@/lib/api-types";

/**
 * Why an entry can't be changed because of protection, or undefined when it can. Reads the
 * badges the listing already carries, so menus and toolbars need no extra request.
 *
 * @example
 * protectionReason(entry); // "This is inside a locked folder."
 */
export function protectionReason(
  entry: { badges: FileBadges; type: FileEntry["type"] } | undefined,
): string | undefined {
  if (!entry || entry.badges.protection === "none") return undefined;
  const label = entry.badges.protection === "locked" ? "locked" : "view-only";
  if (entry.badges.protectionSource === "inherited") return `This is inside a ${label} folder.`;
  return `This ${entry.type === "file" ? "file" : "folder"} is ${label}.`;
}
