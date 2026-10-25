import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { appendUploadChunk, cancelUpload, readUploadStatus } from "@/server/storage/upload";

/** How much has arrived, so an interrupted upload resumes from `received`. */
export const GET = withApi(async ({ params, actor }) =>
  NextResponse.json(await readUploadStatus(actor, readRouteParameter(params, "id"))),
);

const chunkQuerySchema = z.object({ offset: z.coerce.number().int().min(0) });

/** Appends one chunk (raw bytes, at most 8 MiB) at `?offset=`, which must equal the bytes received so far. */
export const PUT = withApi(
  async ({ request, params, query, actor }) =>
    NextResponse.json(await appendUploadChunk(actor, readRouteParameter(params, "id"), query.offset, request.body)),
  { query: chunkQuerySchema },
);

export const DELETE = withApi(async ({ params, actor }) => {
  await cancelUpload(actor, readRouteParameter(params, "id"));
  return NextResponse.json({ ok: true });
});
