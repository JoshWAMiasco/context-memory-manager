import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { readVersioningStatus } from "@/server/versioning";

/** The versioning state of a folder or file: enabled, commits, `.git` size, undo and redo. */
export const GET = withApi(
  async ({ query, storage }) =>
    NextResponse.json(await readVersioningStatus(storage(query.storageId), query.path), {
      headers: { "cache-control": "no-store" },
    }),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
