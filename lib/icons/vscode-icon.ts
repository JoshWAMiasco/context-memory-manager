import {
  DEFAULT_FILE,
  DEFAULT_FOLDER,
  DEFAULT_FOLDER_OPENED,
  getIconForFile,
  getIconForFolder,
  getIconForOpenFolder,
} from "vscode-icons-js";
import { CCM_ICON_OVERRIDES } from "@/lib/icons/vscode-icon-overrides";
import { VSCODE_ICON_NAMES } from "@/lib/icons/vscode-icon-names";
import { readExtension } from "@/lib/file-kinds";

export const VSCODE_ICON_BASE_PATH = "/icons/vscode";

/**
 * Picks the copied icon for a mapped name: the dark variant when the mapping chose a `light_`
 * one (CCM is dark-only), and `fallbackName` when the icon set doesn't have it.
 */
function resolveIconName(mappedName: string | undefined, fallbackName: string): string {
  if (!mappedName) return fallbackName;
  const darkName = mappedName.replace("_light_", "_");
  if (VSCODE_ICON_NAMES.has(darkName)) return darkName;
  return VSCODE_ICON_NAMES.has(mappedName) ? mappedName : fallbackName;
}

function toIconUrl(iconName: string): string {
  return `${VSCODE_ICON_BASE_PATH}/${iconName}`;
}

/**
 * The vscode-icons URL for a file name.
 *
 * @example
 * iconForFile("notes.md"); // "/icons/vscode/file_type_markdown.svg"
 */
export function iconForFile(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  const overrideName = CCM_ICON_OVERRIDES[lowerName] ?? CCM_ICON_OVERRIDES[readExtension(lowerName)];
  if (overrideName && VSCODE_ICON_NAMES.has(overrideName)) return toIconUrl(overrideName);
  return toIconUrl(resolveIconName(getIconForFile(fileName), DEFAULT_FILE));
}

/**
 * The vscode-icons URL for a folder name, open or closed.
 *
 * @example
 * iconForFolder("src", true); // "/icons/vscode/folder_type_src_opened.svg"
 */
export function iconForFolder(folderName: string, isOpen = false): string {
  return isOpen
    ? toIconUrl(resolveIconName(getIconForOpenFolder(folderName), DEFAULT_FOLDER_OPENED))
    : toIconUrl(resolveIconName(getIconForFolder(folderName), DEFAULT_FOLDER));
}
