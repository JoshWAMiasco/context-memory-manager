import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/versioning/repo", () => ({ EXTERNAL_AUTHOR: { name: "CMM (outside changes)" }, withRepo: vi.fn() }));

const { classifyCommit } = await import("@/server/versioning/history");
const { buildCommitMessage } = await import("@/server/versioning/autocommit");

describe("replace steps in the history", () => {
  it("are their own kind", () => {
    expect(classifyCommit("Replace notes/plan.md (uploaded)", "alex")).toBe("replace");
    expect(classifyCommit("Upload notes/plan.md", "alex")).toBe("change");
    expect(classifyCommit("Replace is a word in an edit", "alex")).toBe("change");
  });

  it("keep their own message", () => {
    expect(buildCommitMessage([{ kind: "replace", message: "Replace plan.md (uploaded)" }])).toBe(
      "Replace plan.md (uploaded)",
    );
  });
});
