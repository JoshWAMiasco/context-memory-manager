"use client";

import dayjs from "dayjs";
import { useRouter } from "next/navigation";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  FilePlus,
  GitBranch,
  History,
  KeyRound,
  Lock,
  PanelsTopLeft,
  Settings2,
  Shield,
  SquareTerminal,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { StatisticCard } from "@/components/primitives/statistic-card";
import { BrainIcon } from "@/components/icons/cmm-icons";
import { EncryptionActivityBanner } from "@/components/encryption/encryption-activity-banner";
import { UnlockPanel } from "@/components/encryption/unlock-panel";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { FileIcon } from "@/components/explorer/file-icon";
import { MemoryIcon } from "@/components/explorer/memory-icon";
import { useOpenTerminal } from "@/components/terminal/use-open-terminal";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { FileEntry } from "@/lib/api-types";
import { useEncryptionMutations } from "@/lib/client/encryption";
import { useVersioningStatus } from "@/lib/client/versioning";
import { useFolderStats, useMemory, useMemoryMutations, useProtection } from "@/lib/client/memory";
import type { MemorySummary } from "@/lib/memory";
import { readBaseName } from "@/lib/client/query-keys";
import { buildMemoryHref } from "@/lib/client/routes";

dayjs.extend(relativeTime);

function QuickAction({
  label,
  icon: ActionIcon,
  onClick,
  disabledReason,
  testId,
}: {
  label: string;
  icon: LucideIcon | typeof BrainIcon;
  onClick: () => void;
  disabledReason?: string;
  testId?: string;
}) {
  const button = (
    <Button
      variant="outline-secondary"
      size="small"
      aria-disabled={disabledReason !== undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
      onClick={() => !disabledReason && onClick()}
      leadingIcon={<ActionIcon className="mr-1.5 h-4 w-4" />}
      data-testid={testId}
    >
      {label}
    </Button>
  );
  return disabledReason ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}

/** "An external process modified a protected folder" with Dismiss. */
function TamperBanner({ folderPath }: { folderPath: string }) {
  const { storage } = useExplorer();
  const { data: protection } = useProtection(storage.id, folderPath);
  const { dismissAlert } = useMemoryMutations();
  if (!protection?.violation) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm"
      role="alert"
      data-testid="tamper-banner"
    >
      <ShieldAlert className="h-5 w-5 flex-none text-danger" aria-hidden />
      <span className="flex-1">
        An external process modified a protected folder:{" "}
        <span className="font-medium">{protection.violation.path}</span>, {dayjs(protection.violation.at).fromNow()}.
        CMM made it read-only again.
      </span>
      <Button
        variant="outline-secondary"
        size="small"
        disabled={dismissAlert.isPending}
        onClick={() => dismissAlert.mutate({ storageId: storage.id, path: folderPath })}
      >
        Dismiss
      </Button>
    </div>
  );
}

function StatsSection({ folderPath }: { folderPath: string }) {
  const explorer = useExplorer();
  const { data: stats } = useFolderStats(explorer.storage.id, folderPath);
  const { data: versioning } = useVersioningStatus(explorer.storage.id, folderPath);
  const value = (content: ReactNode) => (stats ? content : "…");
  return (
    <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5" data-testid="folder-stats">
        <StatisticCard
          label="Files"
          value={value(`${stats?.fileCount.toLocaleString()}${stats?.isPartial ? "+" : ""}`)}
        />
        <StatisticCard label="Size" value={value(formatFileSize(stats?.totalBytes ?? 0))} />
        <StatisticCard label="Notes" value={value(stats?.markdownCount.toLocaleString())} />
        <StatisticCard
          label="Last updated"
          value={value(
            stats?.lastModifiedMs ? (
              <span title={dayjs(stats.lastModifiedMs).format("MMMM D, YYYY HH:mm")}>
                {dayjs(stats.lastModifiedMs).format("MMM D, HH:mm")}
              </span>
            ) : (
              "Never"
            ),
          )}
        />
        <StatisticCard
          label="History"
          value={
            versioning ? (
              <span data-testid="stats-versioning" data-versioned={versioning.versioned}>
                {versioning.versioned
                  ? `Versioned${versioning.commitCount === undefined ? "" : ` · ${versioning.commitCount.toLocaleString()}`}`
                  : "Off"}
              </span>
            ) : (
              "…"
            )
          }
        />
      </div>
      {stats && stats.recentFiles.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium text-foreground-muted">Recent files</h3>
          <ul className="divide-y divide-line/50 rounded-md border border-line" data-testid="recent-files">
            {stats.recentFiles.map((recentFile) => (
              <li key={recentFile.path}>
                <button
                  type="button"
                  onClick={() => explorer.selectPath(recentFile.path)}
                  className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted"
                >
                  <FileIcon
                    entry={{
                      name: recentFile.name,
                      type: "file",
                      badges: { isMemory: false, protection: "none", encrypted: false, versioned: false },
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{recentFile.path.slice(folderPath.length + 1)}</span>
                  <span className="text-xs whitespace-nowrap text-foreground-subtle">
                    {formatFileSize(recentFile.size)}
                  </span>
                  <span className="w-36 text-right text-xs whitespace-nowrap text-foreground-subtle">
                    {dayjs(recentFile.mtimeMs).fromNow()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function InlineDescription({
  memory,
  folderPath,
  writeReason,
}: {
  memory: MemorySummary;
  folderPath: string;
  writeReason?: string;
}) {
  const { storage } = useExplorer();
  const { updateMemory } = useMemoryMutations();
  const [draft, setDraft] = useState<string>();
  if (draft === undefined) {
    return (
      <button
        type="button"
        disabled={writeReason !== undefined}
        title={writeReason ?? "Edit the description"}
        onClick={() => setDraft(memory.description)}
        className="mt-1 block w-full cursor-text rounded-sm text-left text-sm leading-relaxed text-foreground-muted hover:bg-surface-muted disabled:cursor-default disabled:hover:bg-transparent"
        data-testid="memory-description"
      >
        {memory.description || <span className="text-foreground-faint">Add a description…</span>}
      </button>
    );
  }
  const save = async () => {
    const description = draft.trim();
    setDraft(undefined);
    if (description === memory.description) return;
    try {
      await updateMemory.mutateAsync({ storageId: storage.id, path: folderPath, description });
      announce("Description saved");
    } catch (saveError) {
      announceError("Couldn't save the description", saveError);
    }
  };
  return (
    <textarea
      autoFocus
      rows={2}
      value={draft}
      aria-label="Memory description"
      onChange={(changeEvent) => setDraft(changeEvent.target.value)}
      onBlur={() => void save()}
      onKeyDown={(keyEvent) => {
        if (keyEvent.key === "Enter" && !keyEvent.shiftKey) {
          keyEvent.preventDefault();
          void save();
        }
        if (keyEvent.key === "Escape") setDraft(undefined);
      }}
      className="mt-1 w-full rounded-md border-line-strong bg-field text-sm"
    />
  );
}

/**
 * What the file pane shows for a folder. A memory gets its icon, name and editable
 * description, stats, recent files and quick actions (one opens it in its own explorer); a plain folder gets the stats, recent files
 * and Convert to memory. Both show the tamper banner when another program changed a protected
 * folder, the unlock panel while an encrypted folder is locked (not while it is being
 * decrypted), and live progress while it is decrypted, encrypted or re-keyed in the background.
 *
 * @example
 * <FolderOverview entry={entry} />
 */
export function FolderOverview({ entry }: { entry: FileEntry }) {
  const explorer = useExplorer();
  const router = useRouter();
  const terminal = useOpenTerminal();
  const { data: memory } = useMemory(explorer.storage.id, entry.path);
  const writeReason = explorer.readWriteReason(entry.path);
  const { lock } = useEncryptionMutations();
  const { data: versioning } = useVersioningStatus(explorer.storage.id, entry.path);
  const encryption = entry.badges.encryption;
  const isEncryptionScope = encryption?.scopePath === entry.path;
  return (
    <div className="grid gap-6" data-testid={memory ? "memory-overview" : "folder-overview"}>
      <TamperBanner folderPath={entry.path} />
      {encryption && encryption.state !== "encrypted" && (
        <EncryptionActivityBanner
          storageId={explorer.storage.id}
          scopePath={encryption.scopePath}
          folderName={readBaseName(encryption.scopePath) || explorer.storage.label}
          state={encryption.state}
          onOpenDetails={() =>
            explorer.openDialog({ kind: "folder-settings", path: encryption.scopePath, tab: "encryption" })
          }
        />
      )}
      {encryption && !encryption.unlocked && encryption.state !== "decrypting" && (
        <UnlockPanel
          storageId={explorer.storage.id}
          path={entry.path}
          folderName={readBaseName(encryption.scopePath) || explorer.storage.label}
          className="p-0"
        />
      )}
      {memory && (
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-lg border border-line bg-surface-subtle">
            <MemoryIcon icon={memory.icon} color={memory.color} className="h-8 w-8" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl font-medium" data-testid="memory-name">
              {memory.name}
            </h3>
            <InlineDescription
              key={memory.description}
              memory={memory}
              folderPath={entry.path}
              writeReason={writeReason}
            />
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2" data-testid="quick-actions">
        <QuickAction
          label={memory ? "New note" : "New file"}
          icon={FilePlus}
          disabledReason={writeReason}
          onClick={() => {
            explorer.setExpanded(entry.path, true);
            explorer.startDraft("file", entry.path);
          }}
          testId="quick-new-note"
        />
        {memory && entry.path !== explorer.rootPath && (
          <QuickAction
            label="Open memory view"
            icon={PanelsTopLeft}
            onClick={() => router.push(buildMemoryHref(explorer.storage.id, entry.path))}
            testId="quick-open-memory-view"
          />
        )}
        {!memory && (
          <QuickAction
            label="Convert to memory"
            icon={BrainIcon}
            disabledReason={writeReason}
            onClick={() => explorer.openDialog({ kind: "convert-memory", path: entry.path })}
            testId="quick-convert-memory"
          />
        )}
        {terminal.isOffered && (
          <QuickAction
            label="Open in terminal"
            icon={SquareTerminal}
            disabledReason={terminal.disabledReason}
            onClick={() => terminal.open(explorer.storage.id, entry.path)}
            testId="quick-open-terminal"
          />
        )}
        <QuickAction
          label="Folder settings"
          icon={Settings2}
          onClick={() => explorer.openDialog({ kind: "folder-settings", path: entry.path })}
          testId="quick-folder-settings"
        />
        <QuickAction
          label="Set protection"
          icon={Shield}
          onClick={() => explorer.openDialog({ kind: "folder-settings", path: entry.path, tab: "protection" })}
          testId="quick-protection"
        />
        {encryption?.unlocked ? (
          <QuickAction
            label="Lock now"
            icon={Lock}
            onClick={() => lock.mutate({ storageId: explorer.storage.id, path: encryption.scopePath })}
            testId="quick-lock-encryption"
          />
        ) : (
          <QuickAction
            label={encryption ? "Encryption settings" : "Enable encryption"}
            icon={KeyRound}
            disabledReason={
              encryption
                ? undefined
                : (writeReason ??
                  (entry.badges.versioned
                    ? "Versioned folders can't be encrypted. Turn versioning off first."
                    : undefined))
            }
            onClick={() =>
              encryption
                ? explorer.openDialog({
                    kind: "folder-settings",
                    path: isEncryptionScope ? entry.path : encryption.scopePath,
                    tab: "encryption",
                  })
                : explorer.openDialog({ kind: "encrypt-folder", path: entry.path })
            }
            testId="quick-encryption"
          />
        )}
        {versioning?.versioned ? (
          <QuickAction
            label="History"
            icon={History}
            onClick={() => explorer.openHistory(entry.path)}
            testId="quick-history"
          />
        ) : (
          <QuickAction
            label="Enable versioning"
            icon={GitBranch}
            disabledReason={
              writeReason ?? (encryption ? "Encrypted folders can't be versioned. Decrypt it first." : undefined)
            }
            onClick={() => explorer.openDialog({ kind: "enable-versioning", path: entry.path })}
            testId="quick-versioning"
          />
        )}
      </div>
      <StatsSection folderPath={entry.path} />
    </div>
  );
}
