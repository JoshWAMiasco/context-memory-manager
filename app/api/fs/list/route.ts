import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathSchema } from "@/server/http/fs-route-input";
import { listDirectory } from "@/server/storage/fs-ops";

const listQuerySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  cursor: z.string().max(64).optional(),
});

export const GET = withApi(
  async ({ query, actor, storage }) =>
    NextResponse.json(await listDirectory(storage(query.storageId), query.path, actor, { cursor: query.cursor })),
  { query: listQuerySchema, storageAccess: storageFromQuery("read") },
);
