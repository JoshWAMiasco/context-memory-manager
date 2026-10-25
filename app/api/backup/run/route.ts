import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { startBackup } from "@/server/backup";
import { backupRequestBodySchema, confirmMirrorPassword, toBackupRequest } from "@/server/http/backup-route-input";

/**
 * Starts a backup from a profile (`{ profileId }`) or ad hoc (`{ adhoc }`): `read` on the
 * source, `write` on the destination; a mirror needs `password`. Returns the queued job; pause,
 * resume and cancel go through `/api/jobs/<id>/<action>`.
 */
export const POST = withApi(
  async ({ body, actor, auth, client }) => {
    await confirmMirrorPassword({ actor, auth, ip: client.ip }, body);
    return NextResponse.json({ job: startBackup(actor, toBackupRequest(body)) }, { status: 202 });
  },
  { body: backupRequestBodySchema },
);
