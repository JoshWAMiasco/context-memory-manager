import "server-only";
import path from "node:path";

/**
 * `path.join` for paths inside storages. Turbopack's file tracer can't tell these runtime paths
 * are user data, and for some patterns copies the whole project into the standalone build; the
 * ignore comment here tells it to skip them.
 *
 * @example
 * joinStoragePath(rootPath, ".cmm-trash", "items", itemUuid);
 */
export function joinStoragePath(...segments: string[]): string {
  // eslint-disable-next-line no-inline-comments
  return path.join(/* turbopackIgnore: true */ ...segments);
}
