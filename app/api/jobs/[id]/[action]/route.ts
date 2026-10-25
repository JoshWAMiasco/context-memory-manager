import { NextResponse } from "next/server";
import { readRouteParameter, withApi } from "@/server/auth/guard";
import { notFound } from "@/server/http/api-error";
import { getJobQueue } from "@/server/jobs/queue";

/** `POST /api/jobs/<id>/pause`, `/resume` or `/cancel`, for the job's owner or an admin. */
export const POST = withApi(({ params, actor }) => {
  const jobId = readRouteParameter(params, "id");
  const jobQueue = getJobQueue();
  switch (readRouteParameter(params, "action")) {
    case "pause": {
      return NextResponse.json({ job: jobQueue.pause(actor, jobId) });
    }
    case "resume": {
      return NextResponse.json({ job: jobQueue.resume(actor, jobId) });
    }
    case "cancel": {
      return NextResponse.json({ job: jobQueue.cancel(actor, jobId) });
    }
    default: {
      throw notFound("Unknown job action.");
    }
  }
});
