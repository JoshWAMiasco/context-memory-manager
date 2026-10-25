import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { startPendingJob } from "@/server/crypto";
import { storageFromBody } from "@/server/http/fs-route-input";

const startBodySchema = z.object({ storageId: z.string().min(1), pendingId: z.uuid() });

/**
 * Wizard step 5 (and the end of a re-key): needs the key file verified; writes `crypto.json`,
 * starts the job and unlocks the folder for this session. Returns `{ job, scopePath }`.
 */
export const POST = withApi(
  async ({ body, actor, auth, storage }) =>
    NextResponse.json(await startPendingJob({ storage: storage(body.storageId), actor }, body.pendingId, auth)),
  { body: startBodySchema, storageAccess: storageFromBody("write") },
);
