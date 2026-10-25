import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { getSetting } from "@/server/settings/store";
import { statEntry } from "@/server/storage/fs-ops";

/** One entry with its ETag, permissions, sniff result, and the viewer limits the client needs to pick a viewer. */
export const GET = withApi(
  async ({ query, actor, storage }) =>
    NextResponse.json({
      ...(await statEntry(storage(query.storageId), query.path, actor)),
      limits: { maxEditBytes: getSetting("editor.maxEditBytes"), csvMaxRows: getSetting("viewer.csvMaxRows") },
    }),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
