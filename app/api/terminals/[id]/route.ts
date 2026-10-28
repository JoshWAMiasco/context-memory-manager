import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { closeTerminal, setTerminalJob } from "@/server/terminal";

const updateTerminalBodySchema = z.object({ isJob: z.boolean() });

/** Makes a terminal a job (it keeps running after CMM closes) or an ordinary terminal again. */
export const PATCH = withApi(
  ({ params, body, actor }) =>
    NextResponse.json({ terminal: setTerminalJob(actor, readRouteParameter(params, "id"), body.isJob) }),
  { body: updateTerminalBodySchema },
);

/** Closes a terminal or discards a job: its shell and whatever runs in it stop, and nothing of it is kept. */
export const DELETE = withApi(({ params, actor }) => {
  closeTerminal(actor, readRouteParameter(params, "id"));
  return NextResponse.json({ ok: true });
});
