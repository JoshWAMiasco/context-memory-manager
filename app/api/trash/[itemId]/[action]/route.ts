import { NextResponse } from "next/server";
import { readRouteParameter, requireHandlerStepUp, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { moveTrashItemsToOsTrash, purgeTrashItems, readTrashedText, restoreTrashItem } from "@/server/trash";

/**
 * `GET /api/trash/<itemId>/content`: a trashed text file, to compare with the file now in its place
 * (after "Replace with file from computer…"). Never cached.
 */
export const GET = withApi(async ({ params, actor }) => {
  if (readRouteParameter(params, "action") !== "content") throw notFound("Unknown trash action.");
  return NextResponse.json(await readTrashedText(actor, readRouteParameter(params, "itemId")), {
    headers: { "cache-control": "no-store" },
  });
});

/** `POST /api/trash/<itemId>/restore`, `/purge` (step-up `delete-permanent`) or `/os-trash` (desktop only). */
export const POST = withApi(async (context) => {
  const { params, actor } = context;
  const trashItemId = readRouteParameter(params, "itemId");
  switch (readRouteParameter(params, "action")) {
    case "restore": {
      return NextResponse.json(await restoreTrashItem(actor, trashItemId));
    }
    case "purge": {
      requireHandlerStepUp(context, "delete-permanent", `trash:${trashItemId}`);
      return NextResponse.json({ removed: await purgeTrashItems(actor, [trashItemId]) });
    }
    case "os-trash": {
      return NextResponse.json({ moved: await moveTrashItemsToOsTrash(actor, [trashItemId]) });
    }
    default: {
      throw notFound("Unknown trash action.");
    }
  }
});
