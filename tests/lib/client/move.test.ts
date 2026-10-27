import { describe, expect, it } from "vitest";
import { findMoveProblem } from "@/lib/client/move";

const home = (path: string) => ({ storageId: "home", path });
const noBusyFolders = new Set<string>();

describe("findMoveProblem", () => {
  it("allows a move into another folder or storage", () => {
    expect(findMoveProblem([home("notes/a.md")], home("archive"), noBusyFolders)).toBeUndefined();
    expect(findMoveProblem([home("notes")], { storageId: "usb", path: "" }, noBusyFolders)).toBeUndefined();
    expect(findMoveProblem([home("archive/notes")], home(""), noBusyFolders)).toBeUndefined();
  });

  it("refuses a folder into itself or into one of its own subfolders", () => {
    expect(findMoveProblem([home("notes")], home("notes"), noBusyFolders)).toBe("A folder can't be moved into itself.");
    expect(findMoveProblem([home("notes")], home("notes/2026"), noBusyFolders)).toBe(
      "A folder can't be moved into itself.",
    );
    expect(findMoveProblem([home("notes")], home("notes-archive"), noBusyFolders)).toBeUndefined();
  });

  it("refuses a move to where the items already are", () => {
    expect(findMoveProblem([home("notes/a.md")], home("notes"), noBusyFolders)).toBe(
      "The item is already in this folder.",
    );
    expect(findMoveProblem([home("notes/a.md"), home("notes/b.md")], home("notes"), noBusyFolders)).toBe(
      "The items are already in this folder.",
    );
    expect(findMoveProblem([home("notes/a.md"), home("other/b.md")], home("notes"), noBusyFolders)).toBeUndefined();
  });

  it("refuses a destination a running move keeps busy", () => {
    expect(findMoveProblem([home("notes/a.md")], home("archive/2026"), new Set(["archive"]))).toBe(
      "Files are being moved here. Wait for the move to finish.",
    );
    expect(findMoveProblem([home("notes/a.md")], home("archive"), new Set(["archive/2026"]))).toBeUndefined();
  });

  it("needs something to move", () => {
    expect(findMoveProblem([], home("archive"), noBusyFolders)).toBe("Choose something to move.");
  });
});
