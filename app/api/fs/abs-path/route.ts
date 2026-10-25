import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { getConfig } from "@/server/config";
import { forbidden } from "@/server/http/api-error";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { readAbsolutePath } from "@/server/storage/fs-ops";

/**
 * The absolute path of a file or folder, so the desktop app can show it in the OS file manager
 *. Desktop mode only: a server never tells browsers where its files live.
 */
export const GET = withApi(
  async ({ query, actor, storage }) => {
    if (getConfig().mode !== "desktop") throw forbidden("Absolute paths are only available in the desktop app.");
    return NextResponse.json({ absolutePath: await readAbsolutePath(storage(query.storageId), query.path, actor) });
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
