import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/auth/guard";
import { storageFromQuery, storagePathQuerySchema, storagePathSchema } from "@/server/http/fs-route-input";
import { validationFailed } from "@/server/http/api-error";
import { readDiff, resolveHistoryTarget } from "@/server/versioning/history";
import { toScopeRelative } from "@/server/versioning/scope";

const diffQuerySchema = storagePathQuerySchema.extend({
  sha: z.string().min(4).max(64),
  /** The file's path before a rename, when the commit renamed it. */
  oldPath: storagePathSchema.optional(),
});

/** A file before and after a commit; the response is never cached. */
export const GET = withApi(
  async ({ query, storage }) => {
    const target = await resolveHistoryTarget(storage(query.storageId), query.path);
    if (target.relativePath === "") throw validationFailed("Choose a file to compare.");
    const oldRelative = query.oldPath ? toScopeRelative(target.scope.path, query.oldPath) : undefined;
    return NextResponse.json(await readDiff(target, query.sha, target.relativePath, oldRelative), {
      headers: { "cache-control": "no-store" },
    });
  },
  { query: diffQuerySchema, storageAccess: storageFromQuery("read") },
);
