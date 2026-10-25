import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireHandlerStepUp, withApi } from "@/server/auth/guard";
import { moveTrashItemsToOsTrash, purgeTrashItems, restoreTrashItem } from "@/server/trash";

const bulkBodySchema = z.object({
  action: z.enum(["restore", "purge", "os-trash"]),
  itemIds: z.array(z.string().min(1)).min(1).max(1000),
});

/** The step-up resource of a bulk purge: the sorted item ids, hashed. */
function readBulkResource(itemIds: readonly string[]): string {
  return `trash:bulk:${createHash("sha256").update(itemIds.toSorted().join("\n")).digest("hex")}`;
}

export const POST = withApi(
  async (context) => {
    const { body, actor } = context;
    if (body.action === "purge") {
      requireHandlerStepUp(context, "delete-permanent", readBulkResource(body.itemIds));
      return NextResponse.json({ removed: await purgeTrashItems(actor, body.itemIds) });
    }
    if (body.action === "os-trash") {
      return NextResponse.json({ moved: await moveTrashItemsToOsTrash(actor, body.itemIds) });
    }
    const restored = [];
    for (const itemId of body.itemIds) restored.push(await restoreTrashItem(actor, itemId));
    return NextResponse.json({ restored });
  },
  { body: bulkBodySchema },
);
