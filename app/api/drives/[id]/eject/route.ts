import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { ejectDrive } from "@/server/storage/drives/eject";
import { getDriveMonitor } from "@/server/storage/drives/monitor";

export const POST = withApi(
  async ({ params }) => {
    const storageId = readRouteParameter(params, "id");
    const drive = getDriveMonitor().findDriveByStorageId(storageId);
    if (!drive) throw notFound("That drive is not plugged in.");
    await ejectDrive(drive, storageId);
    await getDriveMonitor().poll();
    return NextResponse.json({ ok: true });
  },
  { storageAccess: ({ params }) => ({ storageId: readRouteParameter(params, "id"), level: "write" }) },
);
