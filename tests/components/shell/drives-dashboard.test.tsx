// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryLocation } from "@/lib/memory";

const memories = {
  value: [] as MemoryLocation[],
};
const convertMemory = { mutateAsync: vi.fn(), isPending: false };
const routerPush = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn() }) }));
vi.mock("@/hooks/use-server-events", () => ({ useServerEvent: vi.fn() }));
vi.mock("@/lib/client/trash", () => ({ useTrash: () => ({ data: undefined }) }));
vi.mock("@/lib/client/terminals", () => ({ useTerminals: () => ({ data: undefined }) }));
vi.mock("@/lib/client/fs", () => ({
  useStorages: () => ({
    data: [{ id: "home", kind: "internal", label: "Home", available: true, access: "write" }],
    isLoading: false,
  }),
  useDriveActions: () => ({ ejectDrive: { mutateAsync: vi.fn() }, mountDrive: { mutate: vi.fn() } }),
}));
vi.mock("@/lib/client/memory", () => ({
  useMemories: () => ({ data: { memories: memories.value, isSearching: false, isComplete: true }, isLoading: false }),
  useMemoryMutations: () => ({ convertMemory }),
}));
vi.mock("@/components/interactive/toast-notification", () => ({ showToastNotification: vi.fn() }));

const { DrivesDashboard } = await import("@/components/shell/drives-dashboard");

function memoryAt(path: string, name: string): MemoryLocation {
  return {
    storageId: "home",
    storageLabel: "Home",
    path,
    memory: { id: `memory-${path}`, name, description: "", createdAt: "2026-10-27T00:00:00Z" },
  };
}

describe("memory cards on the dashboard", () => {
  beforeEach(() => {
    memories.value = [memoryAt("persona", "Persona"), memoryAt("projects/cmm", "CMM notes")];
    convertMemory.mutateAsync.mockResolvedValue({ memory: null });
  });

  it("offers Convert to normal folder on right-click, and the card leaves the list once converted", async () => {
    const { rerender } = render(<DrivesDashboard isAdmin version="1.1.2" />);
    const personaCard = screen.getByTestId("memory-card-home-persona");
    fireEvent.contextMenu(personaCard, { clientX: 40, clientY: 50 });

    const menu = await screen.findByTestId("memory-card-menu");
    expect(within(menu).getByTestId("menu-open-memory").textContent).toContain("Open memory");
    fireEvent.click(within(menu).getByTestId("menu-convert-folder"));

    const dialog = await screen.findByTestId("convert-folder-dialog");
    expect(screen.getByText('Convert "Persona" to a normal folder?')).not.toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to normal folder" }));
    await waitFor(() =>
      expect(convertMemory.mutateAsync).toHaveBeenCalledWith({ storageId: "home", path: "persona", to: "folder" }),
    );

    // The mutation refreshes the memories query; the server's list no longer has the folder.
    memories.value = [memoryAt("projects/cmm", "CMM notes")];
    rerender(<DrivesDashboard isAdmin version="1.1.2" />);
    await waitFor(() => expect(screen.queryByTestId("memory-card-home-persona")).toBeNull());
    expect(screen.queryByTestId("memory-card-home-projects/cmm")).not.toBeNull();
  });

  it("opens the same menu from the card's actions button", async () => {
    render(<DrivesDashboard isAdmin version="1.1.2" />);
    const card = screen.getByTestId("memory-card-home-projects/cmm");
    fireEvent.click(within(card).getByRole("button", { name: "Actions for CMM notes" }));
    const menu = await screen.findByTestId("memory-card-menu");
    fireEvent.click(within(menu).getByTestId("menu-open-in-storage"));
    expect(routerPush).toHaveBeenCalledWith("/storage/home/projects/cmm");
  });
});
