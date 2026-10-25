import { NextResponse } from "next/server";
import { withApi } from "@/server/auth/guard";
import { getJobQueue } from "@/server/jobs/queue";

export const GET = withApi(({ actor }) => NextResponse.json({ jobs: getJobQueue().list(actor) }));
