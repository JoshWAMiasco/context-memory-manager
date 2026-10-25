import { withApi } from "@/server/auth/guard";
import {
  buildContentDisposition,
  storageFromQuery,
  storagePathQuerySchema,
  toResponseBody,
} from "@/server/http/fs-route-input";
import { isTextKind } from "@/lib/file-kinds";
import { openFileReadStream } from "@/server/storage/fs-ops";

const INLINE_KINDS = new Set(["image", "video", "audio", "pdf"]);

/**
 * Streams a file inline for previews (images, video with ranges). The response is sandboxed:
 * `Content-Security-Policy: sandbox` and `nosniff`, and anything that is not media goes out as
 * plain text or bytes, so a file can never run as a page of this origin. An encrypted file is
 * decrypted on the way (ranges too), marked `x-ccm-encrypted: 1` and never cached.
 */
export const GET = withApi(
  async ({ request, query, actor, storage }) => {
    const fileStream = await openFileReadStream(storage(query.storageId), query.path, actor, {
      rangeHeader: request.headers.get("range"),
    });
    const { kindInfo } = fileStream;
    const contentType = INLINE_KINDS.has(kindInfo.kind)
      ? kindInfo.mime
      : isTextKind(kindInfo.kind)
        ? "text/plain; charset=utf-8"
        : "application/octet-stream";
    const headers: Record<string, string> = {
      "content-type": contentType,
      "content-disposition": buildContentDisposition("inline", fileStream.fileName),
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "cache-control": fileStream.isTransformed ? "no-store" : "private, no-cache",
      etag: fileStream.etag,
      "accept-ranges": "bytes",
    };
    if (fileStream.isTransformed) headers["x-ccm-encrypted"] = "1";
    if (fileStream.range) {
      headers["content-range"] = `bytes ${fileStream.range.start}-${fileStream.range.end}/${fileStream.size}`;
      headers["content-length"] = String(fileStream.range.end - fileStream.range.start + 1);
      return new Response(toResponseBody(fileStream.stream), { status: 206, headers });
    }
    headers["content-length"] = String(fileStream.size);
    return new Response(toResponseBody(fileStream.stream), { status: 200, headers });
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
