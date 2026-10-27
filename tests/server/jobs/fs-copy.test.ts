import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/events/bus", () => ({ getEventBus: () => ({ emit: vi.fn(), on: vi.fn() }) }));
vi.mock("@/server/jobs/queue", () => ({ registerJobType: vi.fn() }));
vi.mock("@/server/storage/copy-tree", () => ({}));
vi.mock("@/server/storage/pipeline", () => ({}));
vi.mock("@/server/storage/roots", () => ({}));
vi.mock("@/server/trash", () => ({}));
vi.mock("@/server/security/path-jail", () => ({}));
vi.mock("@/server/storage/storage-path", () => ({}));

const { fileCopyJob, readMoveLocks } = await import("@/server/jobs/fs-copy");

describe("the folders a move keeps busy", () => {
  it("locks each source's folder and the destination, once each", () => {
    expect(
      readMoveLocks({
        move: true,
        sources: [
          { storageId: "home", path: "notes/a.md" },
          { storageId: "home", path: "notes/b.md" },
          { storageId: "home", path: "top-level" },
        ],
        destination: { storageId: "usb", path: "backup" },
      }),
    ).toEqual([
      { storageId: "home", path: "notes" },
      { storageId: "home", path: "" },
      { storageId: "usb", path: "backup" },
    ]);
  });

  it("locks the destination once when it is also a source's folder", () => {
    expect(
      readMoveLocks({
        move: true,
        sources: [{ storageId: "home", path: "notes/a.md" }],
        destination: { storageId: "home", path: "notes" },
      }),
    ).toEqual([{ storageId: "home", path: "notes" }]);
  });

  it("locks nothing for a copy, and is what the job definition reports", () => {
    const copy = {
      move: false,
      sources: [{ storageId: "home", path: "notes/a.md" }],
      destination: { storageId: "usb", path: "" },
    };
    expect(readMoveLocks(copy)).toEqual([]);
    expect(fileCopyJob.readLocks).toBe(readMoveLocks);
  });
});
