"use client";

import { announceError } from "@/components/explorer/explorer-context";
import { useTerminalMutations, useTerminals } from "@/lib/client/terminals";

/**
 * For "Open in terminal" buttons and menu items: whether to show one (`isOffered`: not for users
 * who can never open terminals), why it is disabled, and a function that opens a terminal in a
 * folder, bringing its panel to the front of the dock.
 *
 * @example
 * const terminal = useOpenTerminal();
 * if (terminal.isOffered) actions.push({ label: "Open in terminal", disabledReason: terminal.disabledReason, onSelect: () => terminal.open(storageId, folderPath) });
 */
export function useOpenTerminal() {
  const { data } = useTerminals();
  const { openTerminal } = useTerminalMutations();
  return {
    isOffered: data !== undefined && data.unavailableCode !== "ROLE",
    disabledReason: data?.available
      ? undefined
      : (data?.unavailableReason ?? "Checking whether terminals are available…"),
    open: (storageId: string, folderPath: string) =>
      openTerminal.mutate(
        { storageId, path: folderPath },
        { onError: (openError) => announceError("Couldn't open a terminal", openError) },
      ),
  };
}
