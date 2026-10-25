import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { closeTerminal } from "@/server/terminal";

/** Closes a terminal: its shell and whatever runs in it stop. */
export const DELETE = withApi(({ params, actor }) => {
  closeTerminal(actor, readRouteParameter(params, "id"));
  return NextResponse.json({ ok: true });
});
