import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { getAutoLockSeconds } from "@/server/settings/store";

/** Explicit activity ping from the idle-lock provider. `withApi` records the activity, as for any mutating request. */
export const POST = withApi(() => NextResponse.json({ ok: true, autoLockSeconds: getAutoLockSeconds() }), {
  allowPasswordChangeRequired: true,
});
