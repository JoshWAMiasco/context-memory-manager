import { NextResponse } from "next/server";
import { z } from "zod";
import type { SetupStatusResponse } from "@/lib/api-types";
import { withApi } from "@/server/auth/guard";
import { createInitialAdmin, isSetupComplete, needsSetupCode } from "@/server/auth/setup";

export const GET = withApi(
  ({ config }) => {
    const status: SetupStatusResponse = {
      complete: isSetupComplete(),
      needsSetupCode: needsSetupCode(),
      mode: config.mode,
    };
    return NextResponse.json(status);
  },
  { auth: false },
);

const setupBodySchema = z.object({
  username: z.string(),
  password: z.string(),
  setupCode: z.string().optional(),
  autoLockMinutes: z.number().int().min(1).max(1440).optional(),
});

export const POST = withApi(
  async ({ body, client }) => {
    const admin = await createInitialAdmin({ ...body, ip: client.ip });
    return NextResponse.json({ user: admin }, { status: 201 });
  },
  { auth: false, body: setupBodySchema },
);
