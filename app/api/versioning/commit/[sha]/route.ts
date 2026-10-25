import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";
import { readCommitFiles, resolveHistoryTarget } from "@/server/versioning/history";

/** One commit and the files it changed; `path` names the versioned folder (or anything in it). */
export const GET = withApi(
  async ({ query, params, storage }) => {
    const target = await resolveHistoryTarget(storage(query.storageId), query.path);
    return NextResponse.json(await readCommitFiles(target, readRouteParameter(params, "sha")), {
      headers: { "cache-control": "no-store" },
    });
  },
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
