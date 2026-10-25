import "server-only";
import { z } from "zod";
import { adhocBackupSchema } from "@/lib/backup";
import type { ResolvedSession } from "@/server/auth/session";
import type { BackupRequest } from "@/server/backup";
import { readRequestMode } from "@/server/backup";
import { requirePasswordConfirm } from "@/server/security/password-confirm";
import type { FileActor } from "@/server/storage/pipeline";

const passwordSchema = z.string().max(1024).optional();

/** `{ profileId }` or `{ adhoc: { source, destination, mode, … } }`, plus the password for a mirror. */
export const backupRequestBodySchema = z.union([
  z.object({ profileId: z.string().min(1), password: passwordSchema }),
  z.object({ adhoc: adhocBackupSchema, password: passwordSchema }),
]);

export type BackupRequestBody = z.output<typeof backupRequestBodySchema>;

export function toBackupRequest(body: BackupRequestBody): BackupRequest {
  return "profileId" in body ? { profileId: body.profileId } : { adhoc: body.adhoc };
}

/**
 * Mirror runs move destination files to the trash, so they need the user's password every time
 *; other modes don't.
 */
export async function confirmMirrorPassword(
  { actor, auth, ip }: { actor: FileActor; auth: ResolvedSession; ip: string },
  body: BackupRequestBody,
): Promise<void> {
  if (readRequestMode(actor, toBackupRequest(body)) !== "mirror") return;
  await requirePasswordConfirm({ user: auth.user, password: body.password ?? "", ip });
}
