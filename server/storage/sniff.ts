import "server-only";
import { open } from "node:fs/promises";
import type { SniffResult } from "@/lib/file-kinds";

export const SNIFF_BYTES = 8192;

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

/** Whether `buffer` starts with the UTF-8 byte order mark. */
export function hasUtf8Bom(buffer: Uint8Array): boolean {
  return buffer.length >= 3 && buffer[0] === UTF8_BOM[0] && buffer[1] === UTF8_BOM[1] && buffer[2] === UTF8_BOM[2];
}

/**
 * Whether `buffer` is valid UTF-8. A multi-byte sequence cut off by the end of the buffer is
 * accepted, because the buffer is often only the first bytes of a file.
 */
export function isValidUtf8(buffer: Uint8Array): boolean {
  let byteIndex = 0;
  while (byteIndex < buffer.length) {
    const leadByte = buffer[byteIndex] ?? 0;
    let continuationCount: number;
    if (leadByte < 0x80) continuationCount = 0;
    else if (leadByte >= 0xc2 && leadByte <= 0xdf) continuationCount = 1;
    else if (leadByte >= 0xe0 && leadByte <= 0xef) continuationCount = 2;
    else if (leadByte >= 0xf0 && leadByte <= 0xf4) continuationCount = 3;
    else return false;
    for (let offset = 1; offset <= continuationCount; offset += 1) {
      if (byteIndex + offset >= buffer.length) return true;
      const continuationByte = buffer[byteIndex + offset] ?? 0;
      if ((continuationByte & 0xc0) !== 0x80) return false;
    }
    byteIndex += continuationCount + 1;
  }
  return true;
}

/** "crlf" when CRLF line breaks are the majority, otherwise "lf" (also for files without breaks). */
export function detectLineEnding(text: string): "lf" | "crlf" {
  const crlfCount = text.split("\r\n").length - 1;
  const lfCount = text.split("\n").length - 1;
  return crlfCount > 0 && crlfCount * 2 >= lfCount ? "crlf" : "lf";
}

/** Inspects the first bytes of a file: a NUL byte means binary; also BOM, UTF-8 validity and line endings. */
export function sniffBuffer(buffer: Uint8Array): SniffResult {
  const sample = buffer.subarray(0, SNIFF_BYTES);
  const hasBom = hasUtf8Bom(sample);
  const isUtf8 = isValidUtf8(sample);
  return {
    isBinary: sample.includes(0),
    hasBom,
    isUtf8,
    lineEnding: detectLineEnding(Buffer.from(sample).toString("utf8")),
  };
}

/** Reads the first 8 KB of `absolutePath` and sniffs it. */
export async function sniffFile(absolutePath: string): Promise<SniffResult> {
  const fileHandle = await open(absolutePath, "r");
  try {
    const sampleBuffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await fileHandle.read(sampleBuffer, 0, SNIFF_BYTES, 0);
    return sniffBuffer(sampleBuffer.subarray(0, bytesRead));
  } finally {
    await fileHandle.close();
  }
}
