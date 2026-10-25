import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathReferenceSchema } from "@/server/http/fs-route-input";
import { createDirectory } from "@/server/storage/fs-ops";

export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json({ entry: await createDirectory(storage(body.storageId), body.path, actor) }, { status: 201 }),
  { body: storagePathReferenceSchema, storageAccess: storageFromBody("write") },
);
