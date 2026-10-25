import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi, type RouteInput } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { joinRelativePath } from "@/server/security/path-jail";
import { initUpload } from "@/server/storage/upload";

const initUploadBodySchema = z.object({
  storageId: z.string().min(1),
  dir: storagePathSchema,
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  overwrite: z.boolean().default(false),
});

/** The step-up resource of an upload: `<storageId>:<dir>/<name>`. */
function readUploadResource({ rawBody }: RouteInput): string {
  const { storageId = "", dir: directory = "", name = "" } = (rawBody ?? {}) as Record<string, unknown>;
  return `${String(storageId)}:${joinRelativePath(String(directory), String(name))}`;
}

/** Starts a chunked upload. The `upload` step-up is asked for here, once per file. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      await initUpload(actor, storage(body.storageId), {
        directory: body.dir,
        name: body.name,
        size: body.size,
        overwrite: body.overwrite,
      }),
      { status: 201 },
    ),
  {
    body: initUploadBodySchema,
    storageAccess: storageFromBody("write"),
    stepUp: { action: "upload", resource: readUploadResource },
  },
);
