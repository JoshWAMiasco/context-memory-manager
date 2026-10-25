import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { createFile } from "@/server/storage/fs-ops";

const createFileBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  content: z
    .string()
    .max(10 * 1024 * 1024)
    .optional(),
});

export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      { entry: await createFile(storage(body.storageId), body.path, actor, body.content) },
      { status: 201 },
    ),
  { body: createFileBodySchema, storageAccess: storageFromBody("write") },
);
