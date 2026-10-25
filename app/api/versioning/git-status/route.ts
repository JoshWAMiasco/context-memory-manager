import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { detectGit } from "@/server/versioning/git-detect";

const gitStatusQuerySchema = z.object({ force: z.enum(["0", "1"]).optional() });

/** Whether git is installed; `?force=1` checks again instead of using the 60-second cache. */
export const GET = withApi(
  async ({ query }) =>
    NextResponse.json(await detectGit({ force: query.force === "1" }), { headers: { "cache-control": "no-store" } }),
  { query: gitStatusQuerySchema },
);
