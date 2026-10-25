/*
 * Memory folder choices: the icons and colours a memory can have. Isomorphic, so the server
 * validates exactly what the dialog offers.
 */

/** Lucide icon names offered for memories; "brain" is the default memory glyph. */
export const MEMORY_ICONS = [
  "brain",
  "bot",
  "sparkles",
  "book-open",
  "notebook-pen",
  "lightbulb",
  "user-round",
  "folder-kanban",
  "flask-conical",
  "code",
  "message-square",
  "graduation-cap",
] as const;

export type MemoryIcon = (typeof MEMORY_ICONS)[number];

/** Memory colours, named after the theme's palette tokens. */
export const MEMORY_COLORS = ["violet", "brand", "info", "success", "warning", "pending", "danger", "slate"] as const;

export type MemoryColor = (typeof MEMORY_COLORS)[number];

/** The CSS colour of each memory colour, read from the design tokens. */
export const MEMORY_COLOR_VALUES: Record<MemoryColor, string> = {
  violet: "var(--color-accent)",
  brand: "var(--color-brand)",
  info: "var(--color-info)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  pending: "var(--color-pending)",
  danger: "var(--color-danger)",
  slate: "var(--color-foreground-muted)",
};

export interface MemoryTemplateSummary {
  id: string;
  name: string;
  description: string;
  /** Paths the template creates; folders end with "/". */
  paths: string[];
}

export interface MemorySummary {
  id: string;
  name: string;
  description: string;
  icon?: MemoryIcon;
  color?: MemoryColor;
  template?: string;
  createdAt: string;
}

/** A memory folder found on a storage, for the dashboard's Memories cards. */
export interface MemoryLocation {
  storageId: string;
  storageLabel: string;
  /** The memory folder, relative to the storage root. */
  path: string;
  memory: MemorySummary;
}

export interface MemoryListing {
  memories: MemoryLocation[];
  /** A storage is still being searched; `memories.changed` follows when it is done. */
  isSearching: boolean;
  /** False when a storage was too big (or a folder too slow) to search completely, so some memories may be missing. */
  isComplete: boolean;
}

export interface MemoryStats {
  fileCount: number;
  totalBytes: number;
  markdownCount: number;
  lastModifiedMs?: number;
  recentFiles: { path: string; name: string; size: number; mtimeMs: number }[];
  /** True when the folder had more than 50,000 files and counting stopped. */
  isPartial: boolean;
}

/**
 * Turns a memory name into a folder name: lower case, spaces to hyphens, only letters, digits,
 * `-`, `_` and `.`.
 *
 * @example
 * slugifyMemoryName("Claude's Persona!"); // "claudes-persona"
 */
export function slugifyMemoryName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/['’]/g, "")
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^[-.]+|[-.]+$/g, "");
  return slug.slice(0, 80) || "memory";
}
