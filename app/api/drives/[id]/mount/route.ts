import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { mountDrive } from "@/server/storage/drives/eject";
import { getDriveMonitor } from "@/server/storage/drives/monitor";

export const POST = withApi(
  async ({ params }) => {
    const drive = getDriveMonitor().findDriveByStorageId(readRouteParameter(params, "id"));
    if (!drive) throw notFound("That drive is not plugged in.");
    await mountDrive(drive);
    await getDriveMonitor().poll();
    return NextResponse.json({ ok: true });
  },
  { roles: ["admin"] },
);
