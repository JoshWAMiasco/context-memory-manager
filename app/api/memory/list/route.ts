import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { listMemories } from "@/server/memory/discovery";

/** The memory folders on the internal storages and plugged-in drives the user can open (cached a minute). */
export const GET = withApi(async ({ auth }) => NextResponse.json(await listMemories(auth.user)));
