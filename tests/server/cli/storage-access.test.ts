import { describe, expect, it } from "vitest";
import { listClosedAncestors, readStorageAclEntries } from "@/server/cli/storage-access";

describe("readStorageAclEntries", () => {
  it("keeps a person's folder open to them, so they can cd into what CMM creates", () => {
    expect(readStorageAclEntries(1000, 999)).toBe("u:cmm:rwX,d:u:cmm:rwX,u:1000:rwX,d:u:1000:rwX");
  });

  it("adds no owner entry for root or the service account", () => {
    expect(readStorageAclEntries(0, 999)).toBe("u:cmm:rwX,d:u:cmm:rwX");
    expect(readStorageAclEntries(999, 999)).toBe("u:cmm:rwX,d:u:cmm:rwX");
  });
});

describe("listClosedAncestors", () => {
  it("lists the parents without an execute bit for others, from the top down", () => {
    const modes: Record<string, number> = { "/": 0o755, "/home": 0o755, "/home/alex": 0o750 };
    expect(listClosedAncestors("/home/alex/notes", (folder) => modes[folder] ?? 0o755)).toEqual(["/home/alex"]);
  });
});
