import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { toSessionSummary } from "@/server/auth/me";
import { listSessions, revokeSession } from "@/server/auth/session";
import { notFound } from "@/server/http/api-error";

/** The signed-in user's own sessions. */
export const GET = withApi(({ auth }) =>
  NextResponse.json({
    sessions: listSessions(auth.user.id).map((session) => toSessionSummary(session, auth.session.idHash)),
  }),
);

const revokeQuerySchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/, "Unknown session") });

/** Revokes one of the signed-in user's own sessions (`?id=`). */
export const DELETE = withApi(
  ({ auth, query }) => {
    if (!revokeSession(query.id, auth.user.id)) throw notFound("That session doesn't exist.");
    return NextResponse.json({ ok: true });
  },
  { query: revokeQuerySchema },
);
