import { readPendingKeyFile } from "@/server/crypto";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { buildContentDisposition } from "@/server/http/fs-route-input";

/**
 * Wizard step 3: downloads the pending key's `.ccmkey` file. It can be downloaded again while the
 * pending slot lives (15 minutes); it is never cached.
 */
export const GET = withApi(async ({ actor, params }) => {
  const { fileName, bytes } = readPendingKeyFile(actor, readRouteParameter(params, "pendingId"));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/json",
      "content-disposition": buildContentDisposition("attachment", fileName),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
