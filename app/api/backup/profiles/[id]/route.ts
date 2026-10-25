import { NextResponse } from "next/server";
import { z } from "zod";
import { backupProfileInputSchema } from "@/lib/backup";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { deleteProfile, requireProfile, toBackupProfile, updateProfile } from "@/server/backup/profiles";
import { requirePasswordConfirm } from "@/server/security/password-confirm";

/** One backup profile. */
export const GET = withApi(({ params, actor }) =>
  NextResponse.json({ profile: toBackupProfile(requireProfile(actor, readRouteParameter(params, "id"))) }),
);

const updateBodySchema = backupProfileInputSchema.extend({ password: z.string().max(1024).optional() });

/** Replaces a profile's settings. Turning on auto-run for a mirror needs the password (see POST). */
export const PATCH = withApi(
  async ({ params, body, actor, auth, client }) => {
    const profileId = readRouteParameter(params, "id");
    const current = requireProfile(actor, profileId);
    const { password, ...input } = body;
    const becomesUnattendedMirror =
      input.mode === "mirror" && input.autoRunOnConnect && !(current.mode === "mirror" && current.autoRunOnConnect);
    if (becomesUnattendedMirror) {
      await requirePasswordConfirm({ user: auth.user, password: password ?? "", ip: client.ip });
    }
    return NextResponse.json({ profile: updateProfile(actor, profileId, input) });
  },
  { body: updateBodySchema },
);

/** Deletes a profile; its History stays. */
export const DELETE = withApi(({ params, actor }) => {
  deleteProfile(actor, readRouteParameter(params, "id"));
  return NextResponse.json({ ok: true });
});
