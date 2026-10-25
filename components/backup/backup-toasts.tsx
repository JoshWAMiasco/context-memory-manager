"use client";

import { CheckCircle, PlugZap, Unplug, XCircle } from "lucide-react";
import { useCallback } from "react";
import { showToastNotification } from "@/components/interactive/toast-notification";
import { useServerEvent } from "@/hooks/use-server-events";
import type { JobSummary } from "@/lib/api-types";
import { BACKUP_JOB_TYPE } from "@/lib/client/backup";

/**
 * Toasts for backups wherever the user is: finished, failed, paused because a
 * drive was unplugged, and started on their own because a drive was plugged in.
 *
 * @example
 * useBackupToasts(); // once, in the always-mounted top bar
 */
export function useBackupToasts(): void {
  const handleState = useCallback(({ job }: { job: JobSummary }) => {
    if (job.type !== BACKUP_JOB_TYPE) return;
    if (job.status === "done") {
      showToastNotification({
        title: "Backup finished",
        description: job.title,
        icon: <CheckCircle className="h-5 w-5 stroke-[1] text-success" />,
        durationInMilliseconds: 8000,
      });
    } else if (job.status === "failed") {
      showToastNotification({
        title: "Backup failed",
        description: job.error ?? job.title,
        icon: <XCircle className="h-5 w-5 stroke-[1] text-danger" />,
        durationInMilliseconds: 10_000,
      });
    } else if (job.status === "paused" && job.error?.startsWith("Drive disconnected")) {
      showToastNotification({
        title: "Backup paused",
        description: job.error,
        icon: <Unplug className="h-5 w-5 stroke-[1] text-warning" />,
        durationInMilliseconds: 10_000,
      });
    }
  }, []);
  const handleTriggered = useCallback(({ name }: { name: string }) => {
    showToastNotification({
      title: "Backup started",
      description: `"${name}" runs because its drive was plugged in.`,
      icon: <PlugZap className="h-5 w-5 stroke-[1] text-primary" />,
      durationInMilliseconds: 8000,
    });
  }, []);
  useServerEvent("job.state", handleState);
  useServerEvent("backup.triggered", handleTriggered);
}
