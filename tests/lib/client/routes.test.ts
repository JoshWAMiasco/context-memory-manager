import { describe, expect, it } from "vitest";
import { buildChangesHref, parseChangesParameter } from "@/lib/client/routes";

describe("What changed links", () => {
  it("opens a file's history on a commit, or on the trash copy a replace kept", () => {
    expect(buildChangesHref("home", "notes/my plan.md", { sha: "4f1c2d3" })).toBe(
      "/storage/home/notes/my%20plan.md?changes=4f1c2d3",
    );
    const trashHref = buildChangesHref("home", "a.md", { trashItemId: "home:9e2b" });
    expect(trashHref).toBe("/storage/home/a.md?changes=trash%3Ahome%3A9e2b");
    expect(parseChangesParameter(new URL(trashHref, "http://x").searchParams.get("changes") ?? undefined)).toEqual({
      trashItemId: "home:9e2b",
    });
  });

  it("reads the parameter back: absent is no history, anything else opens it", () => {
    expect(parseChangesParameter(undefined)).toBeUndefined();
    expect(parseChangesParameter("")).toEqual({});
    expect(parseChangesParameter("4f1c2d3")).toEqual({ sha: "4f1c2d3" });
    expect(parseChangesParameter("not a sha; drop table")).toEqual({});
  });
});
