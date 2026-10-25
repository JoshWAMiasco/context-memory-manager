import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { deleteEntries } from "@/server/storage/fs-ops";

const deleteBodySchema = z.object({
  storageId: z.string().min(1),
  paths: z.array(storagePathSchema).min(1).max(1000),
});

/** Moves entries to the storage's trash; nothing is deleted for good here. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json({ items: await deleteEntries(actor, storage(body.storageId), body.paths) }),
  { body: deleteBodySchema, storageAccess: storageFromBody("write") },
);
