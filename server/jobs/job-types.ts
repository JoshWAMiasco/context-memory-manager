import "server-only";
import { ensureBackupJobType } from "@/server/backup/job";
import { ensureCryptoJobTypes } from "@/server/crypto/jobs";
import { ensureFileCopyJobType } from "@/server/jobs/fs-copy";
import { ensureProtectionJobType } from "@/server/protection";

/**
 * Registers every job type. The job service calls this before recovering interrupted jobs, so a
 * job left over from the last run always finds its handler. Later phases add their types here.
 */
export function registerAllJobTypes(): void {
  ensureFileCopyJobType();
  ensureProtectionJobType();
  ensureCryptoJobTypes();
  ensureBackupJobType();
}
