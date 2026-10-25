"use client";

import { LoaderCircle, CirclePause } from "lucide-react";
import { Button } from "@/components/primitives/button";
import { JobProgressDetails } from "@/components/jobs/job-progress-details";
import type { EncryptionState } from "@/lib/api-types";
import { useEncryptionStatus } from "@/lib/client/encryption";
import { useFolderJob } from "@/lib/client/jobs";

const ACTIVITY: Record<Exclude<EncryptionState, "encrypted">, { title: string; detail: string }> = {
  decrypting: {
    title: "Decrypting in the background",
    detail:
      "Nothing in this folder can be changed until every file is plaintext again, and you don't need to unlock it.",
  },
  encrypting: {
    title: "Encrypting in the background",
    detail: "Nothing in this folder can be changed until every file is encrypted.",
  },
  rekeying: {
    title: "Re-keying in the background",
    detail: "Nothing in this folder can be changed until every file uses the new key.",
  },
};

/**
 * The status of an encrypted folder whose files are being decrypted, encrypted or re-keyed: live
 * progress (bytes, files, speed, time left) while the job runs, or a note to resume it from the
 * Encryption tab when it stopped. Shown in the folder and memory overview.
 *
 * @example
 * <EncryptionActivityBanner storageId={storageId} scopePath="vault" folderName="vault" state="decrypting" onOpenDetails={open} />
 */
export function EncryptionActivityBanner({
  storageId,
  scopePath,
  folderName,
  state,
  onOpenDetails,
}: {
  storageId: string;
  scopePath: string;
  folderName: string;
  state: Exclude<EncryptionState, "encrypted">;
  onOpenDetails: () => void;
}) {
  const liveJob = useFolderJob(storageId, scopePath);
  const { data: status } = useEncryptionStatus(storageId, scopePath);
  const job = liveJob ?? status?.job;
  const isStopped = status !== undefined && (!job || job.status === "paused");
  const activity = ACTIVITY[state];
  return (
    <section
      className={`grid gap-3 rounded-md border p-4 ${isStopped ? "border-warning/40 bg-warning/10" : "border-info/40 bg-info/10"}`}
      role="status"
      aria-live="polite"
      data-testid="encryption-activity"
      data-state={state}
      data-stopped={isStopped}
    >
      <div className="flex flex-wrap items-start gap-3">
        {isStopped ? (
          <CirclePause className="mt-0.5 h-5 w-5 flex-none text-warning" aria-hidden />
        ) : (
          <LoaderCircle
            className="mt-0.5 h-5 w-5 flex-none animate-spin text-info motion-reduce:animate-none"
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">
            {isStopped ? `${activity.title.split(" ")[0]} stopped before it finished` : activity.title}
            <span className="font-normal text-foreground-muted"> · &ldquo;{folderName}&rdquo;</span>
          </p>
          <p className="mt-0.5 text-foreground-muted">
            {isStopped
              ? "Open Encryption settings to resume it with the folder's key file."
              : `${activity.detail} Closing this page doesn't stop it.`}
          </p>
        </div>
        <Button
          variant="outline-secondary"
          size="small"
          onClick={onOpenDetails}
          data-testid="encryption-activity-details"
        >
          {isStopped ? "Resume…" : "Details"}
        </Button>
      </div>
      {job && !isStopped && <JobProgressDetails job={job} showsTitle={false} />}
    </section>
  );
}
