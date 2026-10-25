import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { setCryptoTestSlowdown } from "@/server/crypto/jobs";
import { countHeldKeys, countSessionKeys } from "@/server/crypto/keyring";
import { notFound } from "@/server/http/api-error";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";

/**
 * Test runs only (`CMM_TEST_HOOKS=1`): how many keys the keyring holds in total and for the calling
 * session (`thisSession`), so tests can check that locking wipes them. POST slows crypto jobs down.
 */
export const GET = withApi(({ actor }) => {
  if (!areTestHooksEnabled()) throw notFound();
  return NextResponse.json({ ...countHeldKeys(), thisSession: countSessionKeys(actor.sessionIdHash) });
});

const slowdownSchema = z.object({ chunkDelayMilliseconds: z.number().int().min(0).max(5000) });

/** Test runs only: slows crypto jobs by a pause per chunk, so tests can watch background progress. */
export const POST = withApi(
  ({ body }) => {
    if (!areTestHooksEnabled()) throw notFound();
    setCryptoTestSlowdown(body.chunkDelayMilliseconds);
    return NextResponse.json({ chunkDelayMilliseconds: body.chunkDelayMilliseconds });
  },
  { body: slowdownSchema },
);
