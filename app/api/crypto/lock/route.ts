import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { lockEncryptedFolder } from "@/server/crypto";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";

const lockBodySchema = z.object({ storageId: z.string().min(1), path: storagePathSchema });

/** Locks one encrypted folder for this session: its key is wiped from memory. */
export const POST = withApi(
  async ({ body, actor, storage }) => {
    await lockEncryptedFolder({ storage: storage(body.storageId), path: body.path, actor });
    return NextResponse.json({ locked: true });
  },
  { body: lockBodySchema, storageAccess: storageFromBody("read") },
);
