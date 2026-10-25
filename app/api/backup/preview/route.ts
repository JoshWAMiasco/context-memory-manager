import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { previewBackup } from "@/server/backup";
import { backupRequestBodySchema, toBackupRequest } from "@/server/http/backup-route-input";

/** A dry run: counts, size, warnings, free space and, for a mirror, what goes to the trash. */
export const POST = withApi(
  async ({ body, actor }) => NextResponse.json({ preview: await previewBackup(actor, toBackupRequest(body)) }),
  { body: backupRequestBodySchema },
);
