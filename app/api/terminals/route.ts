import { NextResponse } from "next/server";
import { z } from "zod";
import type { TerminalListResponse } from "@/lib/api-types";
import { withApi } from "@/server/auth/guard";
import { storageFromBody, storagePathSchema } from "@/server/http/fs-route-input";
import { listTerminals, openTerminal, readTerminalAvailability, whenTerminalsReady } from "@/server/terminal";

/** Whether this user may open terminals (and why not), and the terminals and jobs they have open. */
export const GET = withApi(async ({ actor }) => {
  await whenTerminalsReady();
  const availability = readTerminalAvailability(actor);
  const response: TerminalListResponse = {
    available: availability.available,
    terminals: availability.available ? listTerminals(actor) : [],
  };
  if (availability.code) response.unavailableCode = availability.code;
  if (availability.reason) response.unavailableReason = availability.reason;
  return NextResponse.json(response);
});

const openTerminalBodySchema = z.object({
  storageId: z.string().min(1),
  path: storagePathSchema,
  cols: z.number().int().optional(),
  rows: z.number().int().optional(),
  isJob: z.boolean().optional(),
});

/**
 * Opens a terminal in a folder (admins, with terminals turned on), or a job with `isJob`. Its
 * socket is `/api/terminals/<id>/socket`.
 */
export const POST = withApi(
  async ({ body, actor, storage }) =>
    NextResponse.json(
      {
        terminal: await openTerminal(actor, storage(body.storageId), body.path, {
          cols: body.cols,
          rows: body.rows,
          isJob: body.isJob,
        }),
      },
      { status: 201 },
    ),
  { body: openTerminalBodySchema, storageAccess: storageFromBody("read") },
);
