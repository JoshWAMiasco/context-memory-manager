import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { restoreFile } from "@/server/versioning/restore";

const restoreFileBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  sha: z.string().min(4).max(64),
});

/** Restores one file to a version, as a new commit. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(await restoreFile({ storage: storage(body.storageId), path: body.path, actor }, body.sha)),
  { body: restoreFileBodySchema, storageAccess: storageFromBody("write") },
);
