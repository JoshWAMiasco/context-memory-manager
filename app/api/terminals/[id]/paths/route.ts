import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_DROPPED_PATHS } from "@/lib/terminal";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { buildDroppedPathText } from "@/server/terminal/paths";

const droppedPathsBodySchema = z.object({
  storageId: z.string().min(1),
  paths: z.array(storagePathSchema).min(1).max(MAX_DROPPED_PATHS),
});

/** The quoted absolute paths of entries dropped on a terminal, for the terminal's owner. */
export const POST = withApi(
  async ({ params, body, actor, storage }) =>
    NextResponse.json(
      await buildDroppedPathText(actor, readRouteParameter(params, "id"), storage(body.storageId), body.paths),
    ),
  { body: droppedPathsBodySchema, storageAccess: storageFromBody("read") },
);
