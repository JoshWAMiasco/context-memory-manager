import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { readSelectionPaths, storageFromQuery } from "@/server/http/fs-route-input";
import { measureZipDownload } from "@/server/storage/zip-download";

const downloadInfoQuerySchema = z.object({
  storageId: z.string().min(1),
  /** A JSON array of storage-relative paths: a folder, or the selection. */
  paths: z.string().max(200_000),
});

/** What a zip download will hold (files, bytes, encrypted files), for the confirmation before it starts. */
export const GET = withApi(
  async ({ query, actor, storage }) =>
    NextResponse.json(await measureZipDownload(storage(query.storageId), readSelectionPaths(query.paths), actor), {
      headers: { "cache-control": "no-store" },
    }),
  { query: downloadInfoQuerySchema, storageAccess: storageFromQuery("read") },
);
