/**
 * Returns `nextPath` when it is a same-site path ("/settings?tab=1"), otherwise `fallbackPath`.
 * Rejects absolute and protocol-relative URLs ("//evil.example") so `?next=` can't redirect off-site.
 */
export function readSafeNextPath(nextPath: string | string[] | null | undefined, fallbackPath = "/"): string {
  const candidatePath = Array.isArray(nextPath) ? nextPath[0] : nextPath;
  if (
    !candidatePath ||
    !candidatePath.startsWith("/") ||
    candidatePath.startsWith("//") ||
    candidatePath.includes("\\")
  )
    return fallbackPath;
  if (
    candidatePath === "/login" ||
    candidatePath === "/lock" ||
    candidatePath.startsWith("/login?") ||
    candidatePath.startsWith("/lock?")
  )
    return fallbackPath;
  return candidatePath;
}
