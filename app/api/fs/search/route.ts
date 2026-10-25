import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery } from "@/server/http/fs-route-input";
import { searchStorage } from "@/server/storage/search";

const searchQuerySchema = z.object({
  storageId: z.string().min(1),
  query: z.string().trim().min(1).max(200),
});

/** Quick search (⌘K): files and folders in one storage whose name contains `query`. */
export const GET = withApi(
  async ({ query, storage, request }) =>
    NextResponse.json(await searchStorage(storage(query.storageId), query.query, { signal: request.signal })),
  { query: searchQuerySchema, storageAccess: storageFromQuery("read") },
);
