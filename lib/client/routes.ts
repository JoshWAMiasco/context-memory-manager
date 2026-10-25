/**
 * The page URL of a storage, or of a file or folder inside it: `/storage/<id>/<path segments>`,
 * each segment URL-encoded.
 *
 * @example
 * buildStorageHref("home", "notes/today.md"); // "/storage/home/notes/today.md"
 */
export function buildStorageHref(storageId: string, entryPath = ""): string {
  const encodedPath = entryPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/storage/${encodeURIComponent(storageId)}${encodedPath ? `/${encodedPath}` : ""}`;
}

/** Reads `{ storageId, path }` back from a storage page pathname, or undefined for other pages. */
export function parseStorageHref(pathname: string): { storageId: string; path: string } | undefined {
  const pathSegments = pathname.split("/").filter(Boolean);
  if (pathSegments[0] !== "storage" || !pathSegments[1]) return undefined;
  const decode = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  return { storageId: decode(pathSegments[1]), path: pathSegments.slice(2).map(decode).join("/") };
}
