import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { listRuns } from "@/server/backup/runs";

const runsQuerySchema = z.object({
  profileId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** Backup History, newest first, with each run's errors and warnings. */
export const GET = withApi(
  ({ query, actor }) =>
    NextResponse.json({ runs: listRuns(actor, { profileId: query.profileId, limit: query.limit }) }),
  { query: runsQuerySchema },
);
