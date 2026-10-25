import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { listEncryptedFolders } from "@/server/crypto";

/** Every encrypted folder the user can see, with this session's unlock state. */
export const GET = withApi(async ({ actor }) =>
  NextResponse.json(await listEncryptedFolders(actor), { headers: { "cache-control": "no-store" } }),
);
