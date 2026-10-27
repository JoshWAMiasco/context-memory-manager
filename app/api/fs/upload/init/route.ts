import { NextResponse } from "next/server";
import { z } from "zod";
import { readFolderUploadResource } from "@/lib/auth/policy";
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
  /** "Replace with file from computer…": the existing file, as the user last saw it. */
  replace: z
    .object({ expectedEtag: z.string().min(1).max(200).optional() })
    .strict()
    .optional(),
  /** Part of a folder upload into this folder: one step-up for the whole folder covers it. */
  batchRoot: storagePathSchema.optional(),
});

/**
 * The step-up resource of an upload: `<storageId>:<dir>/<name>`, or for a file of a folder upload
 * (`batchRoot`, with `dir` inside it) the folder's grant `<storageId>:<batchRoot>/**`.
 */
function readUploadResource({ rawBody }: RouteInput): string {
  const { storageId = "", dir: directory = "", name = "", batchRoot } = (rawBody ?? {}) as Record<string, unknown>;
  const folderResource =
    typeof batchRoot === "string"
      ? readFolderUploadResource(String(storageId), batchRoot, String(directory))
      : undefined;
  return folderResource ?? `${String(storageId)}:${joinRelativePath(String(directory), String(name))}`;
}

/** Starts a chunked upload. The `upload` step-up is asked for here, once per file or once per folder upload. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      await initUpload(actor, storage(body.storageId), {
        directory: body.dir,
        name: body.name,
        size: body.size,
        overwrite: body.overwrite,
        replace: body.replace,
      }),
      { status: 201 },
    ),
  {
    body: initUploadBodySchema,
    storageAccess: storageFromBody("write"),
    stepUp: { action: "upload", resource: readUploadResource },
  },
);
