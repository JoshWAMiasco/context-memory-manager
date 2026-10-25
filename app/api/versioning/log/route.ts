import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { readLog, resolveHistoryTarget } from "@/server/versioning/history";

const logQuerySchema = storagePathQuerySchema.extend({
  cursor: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** A page of history: the whole versioned folder, or one file or subfolder in it. */
export const GET = withApi(
  async ({ query, storage }) => {
    const target = await resolveHistoryTarget(storage(query.storageId), query.path);
    return NextResponse.json(await readLog(target, { cursor: query.cursor, limit: query.limit }), {
      headers: { "cache-control": "no-store" },
    });
  },
  { query: logQuerySchema, storageAccess: storageFromQuery("read") },
);
