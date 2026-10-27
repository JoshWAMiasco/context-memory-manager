import { z } from "zod";
import { readPendingKeyFile } from "@/server/crypto";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { buildContentDisposition } from "@/server/http/fs-route-input";

const keyFileQuerySchema = z.object({
  /** `key` (default): the key file; `recovery`: the raw copy of a passphrase-protected key, to keep offline. */
  variant: z.enum(["key", "recovery"]).optional(),
});

/**
 * Wizard step 3: downloads the pending key's `.cmmkey` file (`?variant=recovery` for the raw
 * recovery copy of a passphrase-protected key). It can be downloaded again while the pending slot
 * lives (15 minutes); it is never cached.
 */
export const GET = withApi(
  async ({ actor, params, query }) => {
    const { fileName, bytes } = readPendingKeyFile(actor, readRouteParameter(params, "pendingId"), query.variant);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "application/json",
        "content-disposition": buildContentDisposition("attachment", fileName),
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  },
  { query: keyFileQuerySchema },
);
