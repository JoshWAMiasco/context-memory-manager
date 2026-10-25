import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { changeOwnPassword } from "@/server/auth/users";

const changePasswordBodySchema = z.object({
  current: z.string().min(1).max(1024),
  next: z.string().max(1024),
});

/** Changes the signed-in user's password; other sessions are signed out. Also completes a forced change. */
export const POST = withApi(
  async ({ auth, body }) => {
    await changeOwnPassword(auth.user, body.current, body.next, auth.session.idHash);
    return NextResponse.json({ ok: true });
  },
  { allowPasswordChangeRequired: true, body: changePasswordBodySchema },
);
