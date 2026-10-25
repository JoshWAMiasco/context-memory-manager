import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { undo } from "@/server/versioning/undo-redo";

const undoBodySchema = z.object({ storageId: z.string().min(1), path: storagePathSchema });

/** Undo in the versioned folder of `path`: a new commit; history is never rewritten. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(await undo({ storage: storage(body.storageId), path: body.path, actor })),
  { body: undoBodySchema, storageAccess: storageFromBody("write") },
);
