import { Eye, FileWarning, GitBranch, KeyRound, LoaderCircle, Lock } from "lucide-react";
import { Tooltip } from "@/components/interactive/tooltip";
import type { EncryptionBadge, FileBadges } from "@/lib/api-types";
import { readJobPercentage, useActiveJobs } from "@/lib/client/jobs";
import { mergeClassNames } from "@/utilities/merge-class-names";

const BADGE_ICON_CLASS_NAMES = "h-3.5 w-3.5 stroke-[1.75]";

const ACTIVITY_LABELS: Record<EncryptionBadge["state"], string> = {
  encrypting: "Encrypting",
  encrypted: "Encrypted",
  decrypting: "Decrypting",
  rekeying: "Re-keying",
};

/** A spinner with the live percentage on an encrypted folder whose job runs in the background. */
function EncryptionActivityBadge({ encryption }: { encryption: EncryptionBadge }) {
  const job = useActiveJobs().find((activeJob) => activeJob.target?.path === encryption.scopePath);
  const percentage = job ? readJobPercentage(job.progress) : undefined;
  // Another user's job isn't listed for this one: it still runs, without a percentage here.
  const isPaused = job?.status === "paused";
  const tip = isPaused
    ? `${ACTIVITY_LABELS[encryption.state]} stopped before it finished. Resume it from Folder settings → Encryption.`
    : `${ACTIVITY_LABELS[encryption.state]} in the background${percentage === undefined ? "…" : ` · ${percentage}%`}`;
  return (
    <Tooltip content={tip}>
      <span
        className={mergeClassNames("flex items-center gap-0.5", isPaused ? "text-warning" : "text-info")}
        data-testid="badge-encryption-activity"
        data-state={encryption.state}
        aria-label={tip}
      >
        <LoaderCircle
          className={mergeClassNames(BADGE_ICON_CLASS_NAMES, !isPaused && "animate-spin motion-reduce:animate-none")}
        />
        {percentage !== undefined && !isPaused && (
          <span className="text-[10px] leading-none font-medium tabular-nums">{percentage}%</span>
        )}
      </span>
    </Tooltip>
  );
}

/**
 * The small icons after an entry's name: locked, view-only, encrypted (red while locked,
 * green while unlocked for this session; a warning for a plaintext file inside an
 * encrypted folder; a spinner with the percentage on the encrypted folder itself while it is
 * decrypted, encrypted or re-keyed in the background) and versioned, each with a tooltip.
 *
 * @example
 * <ItemBadges badges={entry.badges} path={entry.path} />
 */
export function ItemBadges({
  badges,
  path: entryPath,
  isUnlocked = badges.encryption?.unlocked ?? false,
  showsInherited = false,
  className,
}: {
  badges: FileBadges;
  /** The entry's path: an encrypted folder itself shows its background job's progress. */
  path?: string;
  /** Defaults to the badge's own unlock state for this session. */
  isUnlocked?: boolean;
  /** Also show protection inherited from a parent folder (dimmed); the tree shows only its own. */
  showsInherited?: boolean;
  className?: string;
}) {
  const items = [];
  const isInherited = badges.protectionSource === "inherited";
  if (badges.protection !== "none" && (!isInherited || showsInherited)) {
    const isLocked = badges.protection === "locked";
    items.push({
      key: isLocked ? "locked" : "view-only",
      tip: isInherited
        ? `Inside a ${isLocked ? "locked" : "view-only"} folder: it can't be changed here.`
        : isLocked
          ? "Locked: nobody can change or delete anything inside."
          : "View-only: files can be read but not changed.",
      icon: isLocked ? <Lock className={BADGE_ICON_CLASS_NAMES} /> : <Eye className={BADGE_ICON_CLASS_NAMES} />,
      tone: mergeClassNames(isLocked ? "text-warning" : "text-info", isInherited && "opacity-60"),
    });
  }
  if (badges.encryption?.plaintext) {
    items.push({
      key: "plaintext",
      tip: "Not encrypted on disk: another program wrote it. Encrypt it from Folder settings → Encryption.",
      icon: <FileWarning className={BADGE_ICON_CLASS_NAMES} />,
      tone: "text-warning",
    });
  } else if (badges.encrypted) {
    items.push({
      key: "encrypted",
      tip:
        (isUnlocked ? "Encrypted, unlocked for this session." : "Encrypted and locked. Unlock it with its key file.") +
        (badges.encryption && badges.encryption.state !== "encrypted"
          ? ` ${ACTIVITY_LABELS[badges.encryption.state]} in the background.`
          : ""),
      icon: <KeyRound className={BADGE_ICON_CLASS_NAMES} />,
      tone: isUnlocked ? "text-success" : "text-danger",
    });
  }
  if (badges.versioned) {
    items.push({
      key: "versioned",
      tip: "Versioned: every change is kept in history.",
      icon: <GitBranch className={BADGE_ICON_CLASS_NAMES} />,
      tone: "text-foreground-muted",
    });
  }
  const encryption = badges.encryption;
  const showsActivity =
    encryption !== undefined && encryption.state !== "encrypted" && encryption.scopePath === entryPath;
  if (items.length === 0 && !showsActivity) return null;
  return (
    <span className={mergeClassNames("flex flex-none items-center gap-1", className)}>
      {showsActivity && <EncryptionActivityBadge encryption={encryption} />}
      {items.map((item) => (
        <Tooltip key={item.key} content={item.tip}>
          <span className={item.tone} data-testid={`badge-${item.key}`} aria-label={item.tip}>
            {item.icon}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
