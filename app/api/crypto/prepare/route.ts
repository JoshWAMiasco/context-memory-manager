import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { prepareEncryption } from "@/server/crypto";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { requirePasswordConfirm } from "@/server/security/password-confirm";

const prepareBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  password: z.string().min(1).max(1024),
});

/**
 * Wizard step 2: confirms the password, checks the folder can be encrypted and keeps a
 * new key in a 15-minute pending slot of this session. Returns `{ pendingId, folderName }`.
 */
export const POST = withApi(
  async ({ body, actor, auth, client, storage }) => {
    await requirePasswordConfirm({ user: auth.user, password: body.password, ip: client.ip });
    return NextResponse.json(
      await prepareEncryption({
        storage: storage(body.storageId),
        path: body.path,
        actor,
      }),
    );
  },
  { body: prepareBodySchema, storageAccess: storageFromBody("write") },
);
