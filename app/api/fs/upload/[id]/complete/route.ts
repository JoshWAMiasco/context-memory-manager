import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { completeUpload } from "@/server/storage/upload";

export const POST = withApi(async ({ params, actor }) =>
  NextResponse.json({ entry: await completeUpload(actor, readRouteParameter(params, "id")) }, { status: 201 }),
);
