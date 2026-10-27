import { describe, expect, it } from "vitest";
import type { JobSummary } from "@/lib/api-types";
import { readBusyFolders, readBusyReason } from "@/lib/client/jobs";

function job(status: JobSummary["status"], locks?: JobSummary["locks"]): JobSummary {
  return {
    id: `job-${status}-${locks?.length ?? 0}`,
    type: "fs.copy",
    status,
    progress: { done: 0, total: 0, unit: "bytes" },
    title: "Move",
    locks,
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
  };
}

describe("busy folders from running moves", () => {
  it("collects the locked folders of this storage from queued, running and paused jobs", () => {
    const jobs = [
      job("running", [
        { storageId: "home", path: "notes" },
        { storageId: "usb", path: "" },
      ]),
      job("queued", [{ storageId: "home", path: "archive" }]),
      job("paused", [{ storageId: "home", path: "paused" }]),
      job("done", [{ storageId: "home", path: "finished" }]),
      job("failed", [{ storageId: "home", path: "failed" }]),
      job("running"),
    ];
    expect([...readBusyFolders(jobs, "home")].toSorted()).toEqual(["archive", "notes", "paused"]);
    expect([...readBusyFolders(jobs, "usb")]).toEqual([""]);
    expect(readBusyFolders(jobs, "other").size).toBe(0);
  });

  it("marks a busy folder and everything inside it, not its neighbours", () => {
    const busyFolders = new Set(["notes"]);
    expect(readBusyReason(busyFolders, "notes")).toBeDefined();
    expect(readBusyReason(busyFolders, "notes/2026/today.md")).toBeDefined();
    expect(readBusyReason(busyFolders, "notes-archive")).toBeUndefined();
    expect(readBusyReason(busyFolders, "")).toBeUndefined();
    expect(readBusyReason(new Set([""]), "anything/at/all")).toBeDefined();
  });
});
