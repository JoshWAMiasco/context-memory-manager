import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storagePathReferenceSchema, storagesOfTransfer } from "@/server/http/fs-route-input";
import { moveEntries } from "@/server/storage/fs-ops";

const transferBodySchema = z.object({
  sources: z.array(storagePathReferenceSchema).min(1).max(1000),
  destination: storagePathReferenceSchema,
  conflict: z.enum(["fail", "keep-both"]).optional(),
  /** Confirms that entries leaving an encrypted folder are decrypted. */
  confirmDecrypt: z.boolean().optional(),
});

/** Moves entries: a rename within one disk, otherwise a copy job that sends the sources to the trash. */
export const POST = withApi(
  async ({ body, actor }) =>
    NextResponse.json(
      await moveEntries(actor, body.sources, body.destination, {
        conflict: body.conflict,
        confirmDecrypt: body.confirmDecrypt,
      }),
    ),
  { body: transferBodySchema, storageAccess: storagesOfTransfer("write") },
);
