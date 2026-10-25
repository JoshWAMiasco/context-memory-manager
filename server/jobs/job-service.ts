import "server-only";
import { registerAllJobTypes } from "@/server/jobs/job-types";
import { getJobQueue } from "@/server/jobs/queue";
import type { BackgroundService } from "@/server/services";

/** Registers the job types, pauses jobs a crash interrupted (or requeues them when allowed), and pauses running jobs on shutdown. */
export function createJobService(): BackgroundService {
  return {
    name: "jobs",
    start: () => {
      registerAllJobTypes();
      const interruptedCount = getJobQueue().recoverInterrupted();
      if (interruptedCount > 0)
        console.log(`[cmm] ${interruptedCount} interrupted job(s) are paused; resume them from Jobs`);
    },
    stop: () => getJobQueue().pauseAll(),
  };
}
