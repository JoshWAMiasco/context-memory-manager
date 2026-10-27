import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { requestDecryption } from "@/server/crypto";
import {
  confirmFormPassword,
  readCryptoForm,
  readKeyFileInput,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Decrypt permanently: multipart `keyfile` (with `keyfilePassphrase` when it is protected),
 * `password` and `confirmName` (the folder's name typed). The key file is needed even when the folder is unlocked. Returns `{ job }`.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const result = await withKeyFileAttempt(auth, client.ip, () =>
      requestDecryption(
        { storage: storage(query.storageId), path: query.path, actor },
        readKeyFileInput(form),
        form.fields.get("confirmName") ?? "",
      ),
    );
    return NextResponse.json(result);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("write") },
);
