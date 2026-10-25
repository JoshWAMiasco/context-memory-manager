import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { unlockEncryptedFolder } from "@/server/crypto";
import {
  confirmFormPassword,
  readCryptoForm,
  requireKeyFile,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Unlocks the encrypted folder at or around `?storageId&path` for this session:
 * multipart `keyfile` and `password`. The key is held in memory until the unlock time ends, the
 * session locks or signs out, or someone locks it.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const status = await withKeyFileAttempt(auth, client.ip, () =>
      unlockEncryptedFolder({ storage: storage(query.storageId), path: query.path, actor }, requireKeyFile(form), auth),
    );
    return NextResponse.json(status);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
