import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { encryptPlaintextFiles } from "@/server/crypto";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";

const encryptPlaintextBodySchema = z.object({ storageId: z.string().min(1), path: storagePathSchema });

/** "Encrypt N files now": encrypts plaintext files found inside an unlocked encrypted folder. Returns `{ job }`. */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(await encryptPlaintextFiles({ storage: storage(body.storageId), path: body.path, actor })),
  { body: encryptPlaintextBodySchema, storageAccess: storageFromBody("write") },
);
