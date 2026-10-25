import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { unlockSession } from "@/server/auth/session";

const unlockBodySchema = z.object({ password: z.string().min(1).max(1024) });

export const POST = withApi(
  async ({ auth, body, client }) => {
    if (auth.isLocked) await unlockSession(auth, body.password, client.ip);
    return NextResponse.json({ ok: true });
  },
  { allowLocked: true, allowPasswordChangeRequired: true, body: unlockBodySchema },
);
