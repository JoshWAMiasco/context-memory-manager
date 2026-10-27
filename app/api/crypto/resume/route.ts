import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { resumeEncryption } from "@/server/crypto";
import {
  confirmFormPassword,
  readCryptoForm,
  readKeyFileInput,
  readOptionalKeyFileInput,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Resumes an interrupted encryption, decryption or re-key: multipart `keyfile`,
 * `password`, and for a re-key `newKeyfile`; a protected key file comes with its
 * `keyfilePassphrase` / `newKeyfilePassphrase`. Returns `{ job }`.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const result = await withKeyFileAttempt(auth, client.ip, () =>
      resumeEncryption(
        { storage: storage(query.storageId), path: query.path, actor },
        readKeyFileInput(form),
        readOptionalKeyFileInput(form, "newKeyfile"),
      ),
    );
    return NextResponse.json(result);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("write") },
);
