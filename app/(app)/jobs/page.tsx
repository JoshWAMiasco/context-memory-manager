import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsPage } from "@/components/jobs/jobs-page";
import { requirePageSession } from "@/server/auth/page-guard";

export const metadata: Metadata = { title: "Jobs" };

/** Terminals kept running in the background as jobs; `?id=<terminal id>` opens one across the page. */
export default async function JobsRoute() {
  await requirePageSession();
  return (
    <Suspense>
      <JobsPage />
    </Suspense>
  );
}
