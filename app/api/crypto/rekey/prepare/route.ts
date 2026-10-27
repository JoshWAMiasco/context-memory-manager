import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { prepareRekey } from "@/server/crypto";
import { findKeyFilePassphraseProblem } from "@/lib/key-file";
import { validationFailed } from "@/server/http/api-error";
import {
  confirmFormPassword,
  readCryptoForm,
  readKeyFileInput,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Re-key, first step: multipart `oldKeyfile` (with `oldKeyfilePassphrase` when it is protected),
 * `password`, and optionally `passphrase` for the new key file. Returns a new pending key
 * (`{ pendingId, folderName, hasPassphrase }`) for the keyfile, verify and start steps.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const passphrase = form.fields.get("passphrase") || undefined;
    const passphraseProblem = passphrase === undefined ? undefined : findKeyFilePassphraseProblem(passphrase);
    if (passphraseProblem) throw validationFailed(passphraseProblem);
    const result = await withKeyFileAttempt(auth, client.ip, () =>
      prepareRekey(
        { storage: storage(query.storageId), path: query.path, actor },
        readKeyFileInput(form, "oldKeyfile"),
        { passphrase },
      ),
    );
    return NextResponse.json(result);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("write") },
);
