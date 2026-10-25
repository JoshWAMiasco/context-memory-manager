import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { memoryStats } from "@/server/memory";

/** File count, size, notes, last change and recent files of a memory or folder (cached 30 s). */
export const GET = withApi(
  async ({ query, storage }) => NextResponse.json(await memoryStats(storage(query.storageId), query.path)),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
