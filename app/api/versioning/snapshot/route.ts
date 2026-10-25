import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { createSnapshot } from "@/server/versioning";

const snapshotBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  message: z.string().trim().min(1).max(200),
});

/** Commits the versioned folder now with the user's message. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      await createSnapshot(
        { storage: storage(body.storageId), path: body.path, actor },
        body.message.replaceAll(/\s+/g, " "),
      ),
    ),
  { body: snapshotBodySchema, storageAccess: storageFromBody("write") },
);
