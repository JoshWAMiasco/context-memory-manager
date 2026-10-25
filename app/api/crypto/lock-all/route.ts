import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { lockAllEncryptedFolders } from "@/server/crypto";

/** "Lock all encrypted folders": wipes every key this session holds. */
export const POST = withApi(({ actor }) => {
  lockAllEncryptedFolders(actor);
  return NextResponse.json({ locked: true });
});
