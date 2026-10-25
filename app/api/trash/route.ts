import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { emptyTrash, listTrash } from "@/server/trash";

const listTrashQuerySchema = z.object({ storageId: z.string().min(1).optional() });

/** Trash items of every storage the user can read, or of one storage, newest first. */
export const GET = withApi(async ({ query, actor }) => NextResponse.json(await listTrash(actor, query.storageId)), {
  query: listTrashQuerySchema,
});

const emptyTrashBodySchema = z.object({
  storageId: z.string().min(1),
  confirmText: z.string(),
});

/** Empties the trash of one storage (or "all"). The body must say `confirmText: "EMPTY"`. */
export const DELETE = withApi(
  async ({ body, actor }) => NextResponse.json({ removed: await emptyTrash(actor, body.storageId, body.confirmText) }),
  {
    body: emptyTrashBodySchema,
    stepUp: {
      action: "delete-permanent",
      resource: ({ rawBody }) => `trash:${String((rawBody as { storageId?: unknown } | undefined)?.storageId ?? "")}`,
    },
  },
);
