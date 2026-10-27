import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveStorage } from "@/server/storage/roots";

const readTerminalAvailability = vi.fn();
const requireTerminal = vi.fn();
const readAbsolutePath = vi.fn();

vi.mock("@/server/terminal", () => ({ readTerminalAvailability, requireTerminal }));
vi.mock("@/server/storage/fs-ops", () => ({ readAbsolutePath }));

const { buildDroppedPathText } = await import("@/server/terminal/paths");

const admin = { id: "user-1", role: "admin" as const };
const storage = { id: "home", label: "Home" } as unknown as ActiveStorage;

describe("buildDroppedPathText", () => {
  beforeEach(() => {
    readTerminalAvailability.mockReturnValue({ available: true });
    requireTerminal.mockReturnValue({ summary: { id: "term-1", shell: "zsh" } });
    readAbsolutePath.mockImplementation((_storage: ActiveStorage, entryPath: string) =>
      Promise.resolve(`/srv/cmm/${entryPath}`),
    );
  });

  it("returns the quoted absolute paths for the terminal's owner", async () => {
    await expect(buildDroppedPathText(admin, "term-1", storage, ["notes/a.md", "my notes"])).resolves.toEqual({
      text: "/srv/cmm/notes/a.md '/srv/cmm/my notes' ",
    });
    expect(requireTerminal).toHaveBeenCalledWith(admin, "term-1");
    expect(readAbsolutePath).toHaveBeenCalledWith(storage, "notes/a.md", admin);
  });

  it("refuses a user who can't use terminals, before resolving any path", async () => {
    readTerminalAvailability.mockReturnValue({ available: false, reason: "Only admins can open terminals." });
    await expect(buildDroppedPathText({ id: "u2", role: "viewer" as const }, "term-1", storage, ["a.md"])).rejects.toMatchObject({
      status: 403,
    });
    expect(readAbsolutePath).not.toHaveBeenCalled();
  });

  it("refuses someone else's terminal, before resolving any path", async () => {
    requireTerminal.mockImplementation(() => {
      throw Object.assign(new Error("That terminal does not exist."), { status: 404 });
    });
    await expect(buildDroppedPathText(admin, "term-2", storage, ["a.md"])).rejects.toThrow("does not exist");
    expect(readAbsolutePath).not.toHaveBeenCalled();
  });

  it("quotes for the terminal's shell, and turns an unpasteable path into a validation error", async () => {
    requireTerminal.mockReturnValue({ summary: { id: "term-1", shell: "pwsh" } });
    await expect(buildDroppedPathText(admin, "term-1", storage, ["it's.md"])).resolves.toEqual({
      text: "'/srv/cmm/it''s.md' ",
    });
    readAbsolutePath.mockResolvedValue("/srv/cmm/a\nb");
    await expect(buildDroppedPathText(admin, "term-1", storage, ["x"])).rejects.toMatchObject({ status: 400 });
  });
});
