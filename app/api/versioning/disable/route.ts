import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { disableVersioning } from "@/server/versioning/lifecycle";

const disableBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  mode: z.enum(["archive", "delete"]),
  /** `DELETE HISTORY`, typed, for "delete". */
  confirmText: z.string().max(100).optional(),
});

/** Turns versioning off, keeping the history in `.ccm/git-archive/` or deleting it. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      await disableVersioning(
        { storage: storage(body.storageId), path: body.path, actor },
        { mode: body.mode, confirmText: body.confirmText },
      ),
    ),
  { body: disableBodySchema, storageAccess: storageFromBody("write") },
);
