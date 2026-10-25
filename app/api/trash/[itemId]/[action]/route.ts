import { NextResponse } from "next/server";
import { readRouteParameter, requireHandlerStepUp, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { moveTrashItemsToOsTrash, purgeTrashItems, restoreTrashItem } from "@/server/trash";

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
