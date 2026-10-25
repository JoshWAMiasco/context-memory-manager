import { Badge } from "@/components/primitives/badge";
import type { BackupMode } from "@/lib/api-types";
import { BACKUP_MODE_LABELS } from "@/lib/backup";
import { MODE_COLORS } from "@/lib/backup-topology";

/**
 * A backup's mode as a small badge, in the colour its particles have on the topology (copy cyan,
 * mirror amber, snapshot violet).
 *
 * @example
 * <BackupModeBadge mode="mirror" />
 */
export function BackupModeBadge({ mode }: { mode: BackupMode }) {
  return (
    <Badge
      variant="outline"
      tone="dark"
      data-testid="backup-mode-badge"
      style={{ color: MODE_COLORS[mode], borderColor: `${MODE_COLORS[mode]}80` }}
    >
      {BACKUP_MODE_LABELS[mode]}
    </Badge>
  );
}
