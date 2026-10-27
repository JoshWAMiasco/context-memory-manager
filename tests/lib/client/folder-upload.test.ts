// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client/api", () => ({ ApiError: class extends Error {}, requestJson: vi.fn() }));
const uploadQueue = { add: vi.fn() };
vi.mock("@/lib/client/upload-queue", () => ({ getUploadQueue: () => uploadQueue }));
vi.mock("@/lib/client/step-up", () => ({ requestStepUpGrant: vi.fn() }));

const { isJunkPath, readDroppedTree, readPickedFolder, startFilesUpload, withoutJunk } =
  await import("@/lib/client/folder-upload");
const { requestStepUpGrant } = await import("@/lib/client/step-up");

function fakeFile(name: string, relativePath?: string): File {
  const file = new File(["x"], name);
  if (relativePath) Object.defineProperty(file, "webkitRelativePath", { value: relativePath });
  return file;
}

/** A dropped folder as the browser hands it over, with readEntries returning at most two entries a call. */
function fakeDirectory(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (onEntries: (entries: FileSystemEntry[]) => void) => {
          const batch = children.slice(offset, offset + 2);
          offset += batch.length;
          onEntries(batch);
        },
      } as unknown as FileSystemDirectoryReader;
    },
  } as unknown as FileSystemDirectoryEntry;
}

function fakeFileEntry(name: string): FileSystemFileEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (onFile: (file: File) => void) => onFile(fakeFile(name)),
  } as unknown as FileSystemFileEntry;
}

describe("folder uploads", () => {
  it("leave out OS clutter and .git", () => {
    expect(isJunkPath("Project/.DS_Store")).toBe(true);
    expect(isJunkPath("Project/docs/Thumbs.db")).toBe(true);
    expect(isJunkPath("Project/._notes.md")).toBe(true);
    expect(isJunkPath("Project/.git/config")).toBe(true);
    expect(isJunkPath("Project/.gitignore")).toBe(false);
    expect(isJunkPath("Project/docs/notes.md")).toBe(false);
  });

  it("read a picked folder into files with their folders, parents first", () => {
    const tree = readPickedFolder([
      fakeFile("deep.md", "Project/docs/deep/deep.md"),
      fakeFile("top.md", "Project/top.md"),
    ]);
    expect(tree.files.map(({ file, relativeDirectory }) => `${relativeDirectory}|${file.name}`)).toEqual([
      "Project/docs/deep|deep.md",
      "Project|top.md",
    ]);
    expect(tree.directories).toEqual(["Project", "Project/docs", "Project/docs/deep"]);
  });

  it("read a dropped folder however many entries it has, empty folders included", async () => {
    const dropped = fakeDirectory("Project", [
      fakeFileEntry("a.md"),
      fakeFileEntry(".DS_Store"),
      fakeDirectory("empty", []),
      fakeDirectory("docs", [fakeFileEntry("b.md"), fakeFileEntry("c.md"), fakeFileEntry("d.md")]),
    ]);
    const tree = await readDroppedTree([dropped, fakeFile("loose.txt")]);
    expect(tree.directories).toEqual(["Project", "Project/empty", "Project/docs"]);
    expect(tree.files.map(({ file, relativeDirectory }) => `${relativeDirectory}|${file.name}`)).toEqual([
      "Project|a.md",
      "Project|.DS_Store",
      "Project/docs|b.md",
      "Project/docs|c.md",
      "Project/docs|d.md",
      "|loose.txt",
    ]);
    const cleaned = withoutJunk(tree);
    expect(cleaned.skippedCount).toBe(1);
    expect(cleaned.files).toHaveLength(5);
  });
});

describe("uploading several files", () => {
  it("asks for the password once, for the folder, and gives every file that grant", async () => {
    vi.mocked(requestStepUpGrant).mockReset().mockResolvedValue({ actionToken: "token-1" });
    uploadQueue.add.mockReset();
    const files = [fakeFile("a.md"), fakeFile("b.md"), fakeFile("c.md")];
    await expect(startFilesUpload(files, "home", "notes")).resolves.toBe(true);
    expect(requestStepUpGrant).toHaveBeenCalledTimes(1);
    expect(requestStepUpGrant).toHaveBeenCalledWith("upload", "home:notes/**");
    expect(uploadQueue.add).toHaveBeenCalledWith(files, "home", "notes", { root: "notes", actionToken: "token-1" });
  });

  it("queue nothing when the confirmation is cancelled", async () => {
    vi.mocked(requestStepUpGrant).mockReset().mockResolvedValue(undefined);
    uploadQueue.add.mockReset();
    await expect(startFilesUpload([fakeFile("a.md"), fakeFile("b.md")], "home", "")).resolves.toBe(false);
    expect(uploadQueue.add).not.toHaveBeenCalled();
  });

  it("leave one file to ask as it starts, like before", async () => {
    vi.mocked(requestStepUpGrant).mockReset();
    uploadQueue.add.mockReset();
    const files = [fakeFile("a.md")];
    await startFilesUpload(files, "home", "notes");
    expect(requestStepUpGrant).not.toHaveBeenCalled();
    expect(uploadQueue.add).toHaveBeenCalledWith(files, "home", "notes");
  });
});
