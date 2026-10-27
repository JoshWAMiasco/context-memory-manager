import type { APIRequestContext, APIResponse } from "@playwright/test";
import type { JobSummary, StorageSummary } from "../../lib/api-types";

/** The JSON body of an API response, typed by the caller. */
export async function readJson<Body>(response: APIResponse): Promise<Body> {
  return (await response.json()) as Body;
}

/** The storages the signed-in user can open. */
export async function listStorages(request: APIRequestContext): Promise<StorageSummary[]> {
  const response = await request.get("/api/storages");
  return (await readJson<{ storages: StorageSummary[] }>(response)).storages;
}

/** Every job the user can see. */
export async function listJobs(request: APIRequestContext): Promise<JobSummary[]> {
  return (await readJson<{ jobs: JobSummary[] }>(await request.get("/api/jobs"))).jobs;
}

const FINISHED_STATUSES = new Set(["done", "failed", "cancelled"]);

/** Polls a job until it is done, failed or cancelled, and returns its last state. */
export async function waitForJobToFinish(
  request: APIRequestContext,
  jobId: string,
  timeoutMilliseconds = 60_000,
): Promise<JobSummary> {
  const deadline = Date.now() + timeoutMilliseconds;
  for (;;) {
    const job = (await listJobs(request)).find((listedJob) => listedJob.id === jobId);
    if (job && FINISHED_STATUSES.has(job.status)) return job;
    if (Date.now() > deadline) throw new Error(`Job ${jobId} did not finish: ${job?.status ?? "not listed"}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export interface StoragePathPair {
  storageId: string;
  path: string;
}

/** Starts a move through the API; a cross-disk move answers with its background job. */
export async function startMove(
  request: APIRequestContext,
  sources: StoragePathPair[],
  destination: StoragePathPair,
): Promise<{ paths: string[]; job?: JobSummary }> {
  const response = await request.post("/api/fs/move", { data: { sources, destination, conflict: "keep-both" } });
  if (!response.ok()) throw new Error(`Move refused: ${response.status()} ${await response.text()}`);
  return readJson(response);
}

/** Pauses a job at once, so its folders stay busy for as long as a test needs to look at them. */
export async function pauseJob(request: APIRequestContext, jobId: string): Promise<JobSummary> {
  const response = await request.post(`/api/jobs/${jobId}/pause`);
  if (!response.ok()) throw new Error(`Could not pause the job: ${response.status()} ${await response.text()}`);
  return (await readJson<{ job: JobSummary }>(response)).job;
}

export async function cancelJob(request: APIRequestContext, jobId: string): Promise<void> {
  await request.post(`/api/jobs/${jobId}/cancel`);
}
