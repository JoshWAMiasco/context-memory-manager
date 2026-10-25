import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { setBackupTestSlowdown } from "@/server/backup/copy";
import { setBackupTriggerSettleMilliseconds } from "@/server/backup/triggers";
import { notFound } from "@/server/http/api-error";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";

const debugBodySchema = z.object({
  /** A pause after each copied chunk, so tests can watch a backup in progress. */
  chunkDelayMilliseconds: z.number().int().min(0).max(5000).optional(),
  /** The wait after a drive appears before backups run or resume. */
  triggerSettleMilliseconds: z.number().int().min(0).max(60_000).optional(),
});

/** Test runs only (`CMM_TEST_HOOKS=1`): slows backups down or shortens the plug-in wait. */
export const POST = withApi(
  ({ body }) => {
    if (!areTestHooksEnabled()) throw notFound();
    if (body.chunkDelayMilliseconds !== undefined) setBackupTestSlowdown(body.chunkDelayMilliseconds);
    if (body.triggerSettleMilliseconds !== undefined)
      setBackupTriggerSettleMilliseconds(body.triggerSettleMilliseconds);
    return NextResponse.json({ ok: true });
  },
  { body: debugBodySchema },
);
