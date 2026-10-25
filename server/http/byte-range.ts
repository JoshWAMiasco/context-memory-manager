import "server-only";

/** Parses a single `Range: bytes=a-b` header; anything else (several ranges, garbage) is ignored. */
export function parseByteRange(rangeHeader: string | null, size: number): { start: number; end: number } | undefined {
  const rangeMatch = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
  if (!rangeMatch || size === 0) return undefined;
  const [, startText = "", endText = ""] = rangeMatch;
  if (startText === "" && endText === "") return undefined;
  if (startText === "") {
    const suffixLength = Math.min(Number(endText), size);
    return { start: size - suffixLength, end: size - 1 };
  }
  const start = Number(startText);
  const end = endText === "" ? size - 1 : Math.min(Number(endText), size - 1);
  return start <= end && start < size ? { start, end } : undefined;
}
