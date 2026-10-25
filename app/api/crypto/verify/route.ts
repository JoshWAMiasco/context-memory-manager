import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { verifyPendingKeyFile } from "@/server/crypto";
import { readCryptoForm, requireKeyFile } from "@/server/http/crypto-route-input";
import { validationFailed } from "@/server/http/api-error";

/** Wizard step 4: the uploaded key file must be the one just downloaded (multipart `pendingId`, `keyfile`). */
export const POST = withApi(async ({ request, actor }) => {
  const form = await readCryptoForm(request);
  const pendingId = form.fields.get("pendingId");
  if (!pendingId) throw validationFailed("The wizard step is missing its key.");
  verifyPendingKeyFile(actor, pendingId, requireKeyFile(form));
  return NextResponse.json({ verified: true });
});
