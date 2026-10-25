import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { areTestHooksEnabled } from "@/server/runtime/test-hooks";
import { setExternalSnapshotDebounce } from "@/server/versioning/external-snapshots";
import { setGitHiddenForTests } from "@/server/versioning/git-detect";

const debugBodySchema = z.object({
  /** Pretend git isn't installed (the "no git" e2e). */
  hideGit: z.boolean().optional(),
  /** The quiet time before outside changes are committed. */
  snapshotDebounceMilliseconds: z.number().int().min(100).max(60_000).optional(),
});

/** Test runs only (`CCM_TEST_HOOKS=1`): hides git or shortens the external-change wait. */
export const POST = withApi(
  ({ body }) => {
    if (!areTestHooksEnabled()) throw notFound();
    if (body.hideGit !== undefined) setGitHiddenForTests(body.hideGit);
    if (body.snapshotDebounceMilliseconds !== undefined) setExternalSnapshotDebounce(body.snapshotDebounceMilliseconds);
    return NextResponse.json({ ok: true });
  },
  { body: debugBodySchema },
);
