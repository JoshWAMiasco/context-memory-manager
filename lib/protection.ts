/*
 * Folder and file protection modes, shared by the server and the browser. Isomorphic.
 */

export const PROTECTION_MODES = ["none", "view-only", "locked"] as const;

export type ProtectionMode = (typeof PROTECTION_MODES)[number];

const PROTECTION_RANK: Record<ProtectionMode, number> = { none: 0, "view-only": 1, locked: 2 };

/**
 * The stricter of two modes: `locked` beats `view-only` beats `none`.
 *
 * @example
 * stricterProtection("view-only", "locked"); // "locked"
 */
export function stricterProtection(first: ProtectionMode, second: ProtectionMode): ProtectionMode {
  return PROTECTION_RANK[second] > PROTECTION_RANK[first] ? second : first;
}

export const PROTECTION_LABELS: Record<ProtectionMode, string> = {
  none: "None",
  "view-only": "View-only",
  locked: "Locked",
};
