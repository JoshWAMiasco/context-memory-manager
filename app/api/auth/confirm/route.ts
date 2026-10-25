import { NextResponse } from "next/server";
import { z } from "zod";
import { STEP_UP_ACTIONS } from "@/lib/auth/policy";
import { withApi } from "@/server/auth/guard";
import { confirmStepUp } from "@/server/security/step-up";

const confirmBodySchema = z.object({
  password: z.string().min(1).max(1024),
  action: z.enum(STEP_UP_ACTIONS),
  resource: z.string().min(1).max(4096),
});

/** Step-up: checks the password and returns `{ actionToken }` for remote clients, or `{}` once LAN confirmation is recorded. */
export const POST = withApi(
  async ({ auth, body, client, config }) => {
    const confirmation = await confirmStepUp({
      resolvedSession: auth,
      action: body.action,
      resource: body.resource,
      networkClass: client.networkClass,
      mode: config.mode,
      password: body.password,
      ip: client.ip,
    });
    return NextResponse.json(confirmation);
  },
  { body: confirmBodySchema },
);
