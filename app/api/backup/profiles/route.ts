import { NextResponse } from "next/server";
import { z } from "zod";
import { backupProfileInputSchema } from "@/lib/backup";
import { withApi } from "@/server/auth/guard";
import { createProfile, listProfiles } from "@/server/backup/profiles";
import { requirePasswordConfirm } from "@/server/security/password-confirm";

/** The backup profiles this user made (admins: every profile), with their last run. */
export const GET = withApi(({ actor }) => NextResponse.json({ profiles: listProfiles(actor) }));

const createBodySchema = backupProfileInputSchema.extend({ password: z.string().max(1024).optional() });

/**
 * Saves a backup profile: `read` on the source storage, `write` on the destination. A
 * mirror that runs on its own when a drive is plugged in needs the password when it is saved,
 * since no one is there to confirm each run.
 */
export const POST = withApi(
  async ({ body, actor, auth, client }) => {
    const { password, ...input } = body;
    if (input.mode === "mirror" && input.autoRunOnConnect) {
      await requirePasswordConfirm({ user: auth.user, password: password ?? "", ip: client.ip });
    }
    return NextResponse.json({ profile: await createProfile(actor, input) }, { status: 201 });
  },
  { body: createBodySchema },
);
