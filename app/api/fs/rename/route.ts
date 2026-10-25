import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { renameEntry } from "@/server/storage/fs-ops";

const renameBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  newName: z.string().min(1).max(255),
});

export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json({ entry: await renameEntry(storage(body.storageId), body.path, body.newName, actor) }),
  { body: renameBodySchema, storageAccess: storageFromBody("write") },
);
