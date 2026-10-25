/*
 * How links and images inside a Markdown file are followed. Isomorphic.
 */

export type MarkdownLinkTarget =
  | { kind: "external"; href: string }
  | { kind: "storage"; path: string; hash?: string }
  | { kind: "anchor"; hash: string }
  | { kind: "blocked"; reason: string };

const EXTERNAL_SCHEME_PATTERN = /^(?:https?:|mailto:|tel:)/i;
const ANY_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolves `relativePath` against the folder of `filePath`, both storage-relative. A leading `/`
 * means the storage root. Returns undefined when the result would leave the storage.
 *
 * @example
 * resolveStoragePath("notes/today.md", "../images/a.png"); // "images/a.png"
 */
export function resolveStoragePath(filePath: string, relativePath: string): string | undefined {
  const segments = relativePath.startsWith("/") ? [] : filePath.split("/").slice(0, -1);
  for (const segment of relativePath.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return undefined;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function decodeSafely(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Where a Markdown link in `filePath` goes: an external page, another entry of the same storage,
 * an anchor on this page, or nowhere (unknown schemes such as `javascript:`, paths leaving the
 * storage).
 *
 * @example
 * resolveMarkdownLink("notes/a.md", "b.md#todo"); // { kind: "storage", path: "notes/b.md", hash: "todo" }
 */
export function resolveMarkdownLink(filePath: string, href: string): MarkdownLinkTarget {
  const trimmedHref = href.trim();
  if (trimmedHref.startsWith("#")) return { kind: "anchor", hash: decodeSafely(trimmedHref.slice(1)) };
  if (EXTERNAL_SCHEME_PATTERN.test(trimmedHref) || trimmedHref.startsWith("//")) {
    return { kind: "external", href: trimmedHref.startsWith("//") ? `https:${trimmedHref}` : trimmedHref };
  }
  if (ANY_SCHEME_PATTERN.test(trimmedHref)) return { kind: "blocked", reason: "This kind of link can't be opened." };
  const [pathPart = "", hash] = trimmedHref.split("#", 2);
  const withoutQuery = pathPart.split("?", 1)[0] ?? "";
  if (withoutQuery === "")
    return hash ? { kind: "anchor", hash: decodeSafely(hash) } : { kind: "blocked", reason: "Empty link." };
  const resolvedPath = resolveStoragePath(filePath, decodeSafely(withoutQuery));
  if (resolvedPath === undefined) return { kind: "blocked", reason: "This link points outside the storage." };
  return { kind: "storage", path: resolvedPath, hash: hash ? decodeSafely(hash) : undefined };
}

export type MarkdownImageSource =
  | { kind: "storage"; path: string }
  | { kind: "inline"; source: string }
  | { kind: "blocked"; reason: "external" | "outside" | "unsupported" };

/**
 * Where a Markdown image in `filePath` loads from. Remote images are blocked (CCM works offline
 * and doesn't leak what you read); `data:` images are shown; relative paths load from the storage.
 *
 * @example
 * resolveMarkdownImage("notes/a.md", "https://example.com/x.png"); // { kind: "blocked", reason: "external" }
 */
export function resolveMarkdownImage(filePath: string, source: string): MarkdownImageSource {
  const trimmedSource = source.trim();
  if (/^data:image\//i.test(trimmedSource)) return { kind: "inline", source: trimmedSource };
  if (/^https?:/i.test(trimmedSource) || trimmedSource.startsWith("//")) return { kind: "blocked", reason: "external" };
  if (ANY_SCHEME_PATTERN.test(trimmedSource)) return { kind: "blocked", reason: "unsupported" };
  const resolvedPath = resolveStoragePath(filePath, decodeSafely(trimmedSource.split(/[?#]/, 1)[0] ?? ""));
  if (resolvedPath === undefined || resolvedPath === "") return { kind: "blocked", reason: "outside" };
  return { kind: "storage", path: resolvedPath };
}
