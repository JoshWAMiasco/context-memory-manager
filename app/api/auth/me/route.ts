import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { buildMeResponse } from "@/server/auth/me";

export const GET = withApi(({ auth, client, config }) => NextResponse.json(buildMeResponse(auth, client, config)), {
  allowPasswordChangeRequired: true,
});
