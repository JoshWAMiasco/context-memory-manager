import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { prepareRekey } from "@/server/crypto";
import {
  confirmFormPassword,
  readCryptoForm,
  requireKeyFile,
  withKeyFileAttempt,
} from "@/server/http/crypto-route-input";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/**
 * Re-key, first step: multipart `oldKeyfile` and `password`. Returns a new pending key
 * (`{ pendingId, folderName }`) for the keyfile, verify and start steps.
 */
export const POST = withApi(
  async ({ request, query, actor, auth, client, storage }) => {
    const form = await readCryptoForm(request);
    await confirmFormPassword(form, auth, client.ip);
    const result = await withKeyFileAttempt(auth, client.ip, () =>
      prepareRekey({ storage: storage(query.storageId), path: query.path, actor }, requireKeyFile(form, "oldKeyfile")),
    );
    return NextResponse.json(result);
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("write") },
);
