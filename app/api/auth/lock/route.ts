import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { lockSession } from "@/server/auth/session";

/** Locks the session now. Locking an already locked session is fine. */
export const POST = withApi(
  ({ auth }) => {
    if (!auth.isLocked) lockSession(auth.session.idHash, auth.user.id, "manual");
    return NextResponse.json({ ok: true });
  },
  { allowLocked: true, allowPasswordChangeRequired: true },
);
