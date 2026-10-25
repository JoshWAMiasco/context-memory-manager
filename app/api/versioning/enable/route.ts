import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { enableVersioning } from "@/server/versioning/lifecycle";

const enableBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  /** Keep the `.git` the folder already has (after `{ needsAdoptConfirm: true }`). */
  adopt: z.boolean().optional(),
  /** Bring back an archived history (its name from the status). */
  restoreArchive: z.string().max(200).optional(),
});

/** Turns versioning on: `{ enabled, scopePath }`, or `{ needsAdoptConfirm }` for an existing `.git`. */
export const POST = withApi(
  async ({ body, actor, storage }) => {
    const result = await enableVersioning(
      { storage: storage(body.storageId), path: body.path, actor },
      { adopt: body.adopt, restoreArchive: body.restoreArchive },
    );
    return NextResponse.json("needsAdoptConfirm" in result ? result : { enabled: true, scopePath: result.scope.path });
  },
  { body: enableBodySchema, storageAccess: storageFromBody("write") },
);
