"use client";

import Link from "next/link";
import { announceError } from "@/components/explorer/explorer-context";
import { showToastNotification } from "@/components/interactive/toast-notification";
import type { TerminalSummary } from "@/lib/api-types";
import type { useTerminalMutations } from "@/lib/client/terminals";

/**
 * The Jobs page, or one job on it.
 *
 * @example
 * buildJobsHref("4f1c…"); // "/jobs?id=4f1c…"
 */
export function buildJobsHref(terminalId?: string): string {
  return terminalId ? `/jobs?${new URLSearchParams({ id: terminalId })}` : "/jobs";
}

/**
 * Makes a terminal a job: it leaves the dock for the Jobs page and keeps running after CMM is
 * closed, restarted or updated. A toast says where it went.
 *
 * @example
 * const { setJob } = useTerminalMutations();
 * runAsJob(setJob, terminal);
 */
export function runAsJob(setJob: ReturnType<typeof useTerminalMutations>["setJob"], terminal: TerminalSummary): void {
  // A promise, not mutate callbacks: the panel that asked unmounts as soon as it leaves the dock.
  setJob
    .mutateAsync({ terminalId: terminal.id, isJob: true })
    .then(() =>
      showToastNotification({
        title: `"${terminal.title}" runs as a job`,
        description: "It keeps running after CMM is closed, restarted or updated.",
        tone: "success",
        actions: (
          <Link href={buildJobsHref(terminal.id)} className="text-sm font-medium text-brand hover:underline">
            Open in Jobs
          </Link>
        ),
      }),
    )
    .catch((jobError: unknown) => announceError("Couldn't make it a job", jobError));
}
