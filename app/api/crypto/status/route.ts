import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { readEncryptionStatus } from "@/server/crypto";
import { storageFromQuery, storagePathQuerySchema } from "@/server/http/fs-route-input";

/** The encryption state of a folder or file and whether this session has it unlocked. */
export const GET = withApi(
  async ({ query, actor, storage }) =>
    NextResponse.json(await readEncryptionStatus({ storage: storage(query.storageId), path: query.path, actor }), {
      headers: { "cache-control": "no-store" },
    }),
  { query: storagePathQuerySchema, storageAccess: storageFromQuery("read") },
);
