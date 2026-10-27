// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJson = vi.fn();
vi.mock("@/lib/client/api", () => ({ requestJson }));

const { copyEntryPath, readEntryAbsolutePath } = await import("@/lib/client/desktop");

describe("Copy full path", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("asks the server for the absolute path and puts it on the clipboard", async () => {
    requestJson.mockResolvedValue({ absolutePath: "/Users/me/Memories/persona/notes.md" });
    await expect(copyEntryPath("home", "persona/notes.md")).resolves.toBe("/Users/me/Memories/persona/notes.md");
    expect(requestJson).toHaveBeenCalledWith("/api/fs/abs-path?storageId=home&path=persona%2Fnotes.md");
    expect(writeText).toHaveBeenCalledWith("/Users/me/Memories/persona/notes.md");
  });

  it("accepts Windows paths and refuses anything that isn't absolute", async () => {
    requestJson.mockResolvedValue({ absolutePath: String.raw`C:\Users\me\notes.md` });
    await expect(readEntryAbsolutePath("home", "notes.md")).resolves.toBe(String.raw`C:\Users\me\notes.md`);
    requestJson.mockResolvedValue({ absolutePath: "persona/notes.md" });
    await expect(copyEntryPath("home", "persona/notes.md")).rejects.toThrow("absolute path");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the copy command when the Clipboard API refuses", async () => {
    requestJson.mockResolvedValue({ absolutePath: "/srv/files/a.txt" });
    writeText.mockRejectedValue(new Error("denied"));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await expect(copyEntryPath("home", "a.txt")).resolves.toBe("/srv/files/a.txt");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });
});
