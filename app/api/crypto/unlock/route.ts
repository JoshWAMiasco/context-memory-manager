import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { unlockEncryptedFolder } from "@/server/crypto";
import {
  confirmFormPassword,
  readCryptoForm,
  readKeyFileInput,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Unlocks the encrypted folder at or around `?storageId&path` for this session:
 * multipart `keyfile` (with `keyfilePassphrase` when it is protected) and `password`. The
 * passphrase is used once, here: the unwrapped key is held in memory until the unlock time ends,
 * the session locks or signs out, or someone locks it, and viewing files needs nothing more.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const status = await withKeyFileAttempt(auth, client.ip, () =>
      unlockEncryptedFolder(
        { storage: storage(query.storageId), path: query.path, actor },
        readKeyFileInput(form),
        auth,
      ),
    );
    return NextResponse.json(status);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
