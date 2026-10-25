import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import {
  storageFromBody,
  storageFromQuery,
  storagePathQuerySchema,
  storagePathSchema,
} from "@/server/http/fs-route-input";
import { ApiRouteError } from "@/server/http/api-error";
import { getSetting } from "@/server/settings/store";
import { readTextFile, writeTextFile } from "@/server/storage/fs-ops";

/**
 * Reads a text file for the editor. Never cached: the text may be decrypted content of an
 * encrypted folder, which must not land in the browser's disk cache.
 */
export const GET = withApi(
  async ({ query, actor, storage }) =>
    NextResponse.json(
      await readTextFile(storage(query.storageId), query.path, actor, { maxBytes: getSetting("editor.maxEditBytes") }),
      { headers: { "cache-control": "no-store" } },
    ),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);

const writeTextBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  content: z.string().max(50 * 1024 * 1024),
  lineEnding: z.enum(["lf", "crlf"]).optional(),
  encoding: z.enum(["utf-8", "utf-8-bom"]).optional(),
});

/**
 * Saves editor text. Send the ETag you read as `If-Match`; a stale one is 412 `ETAG_MISMATCH`.
 * Content over the `editor.maxEditBytes` setting is 413 `TOO_LARGE_TO_EDIT`.
 */
export const PUT = withApi(
  async ({ request, body, actor, storage }) => {
    const maxEditBytes = getSetting("editor.maxEditBytes");
    if (Buffer.byteLength(body.content, "utf8") > maxEditBytes) {
      throw new ApiRouteError(413, "TOO_LARGE_TO_EDIT", "This file is too large to edit here.", {
        limit: maxEditBytes,
      });
    }
    const fileStat = await writeTextFile(storage(body.storageId), body.path, body.content, actor, {
      ifMatch: request.headers.get("if-match") ?? undefined,
      lineEnding: body.lineEnding,
      encoding: body.encoding,
    });
    return NextResponse.json(fileStat, { headers: { etag: fileStat.etag } });
  },
  { body: writeTextBodySchema, storageAccess: storageFromBody("write") },
);
