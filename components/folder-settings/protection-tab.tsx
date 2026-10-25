"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Eye, Lock, ShieldAlert, ShieldOff, TriangleAlert, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/primitives/button";
import { FormErrorMessage, FormLabel } from "@/components/primitives/form-field";
import { PasswordInput } from "@/components/primitives/password-input";
import { ProgressBar } from "@/components/primitives/progress-bar";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { useJobProgress } from "@/hooks/use-job-progress";
import type { JobSummary } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { useMemoryMutations, useProtection } from "@/lib/client/memory";
import { QUERY_KEYS } from "@/lib/client/query-keys";
import { PROTECTION_LABELS, type ProtectionMode } from "@/lib/protection";
import { mergeClassNames } from "@/utilities/merge-class-names";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

interface ModeOption {
  mode: ProtectionMode;
  icon: LucideIcon;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  { mode: "none", icon: ShieldOff, description: "Anyone with write access can change and delete it." },
  {
    mode: "view-only",
    icon: Eye,
    description:
      "It can be opened, copied and downloaded, but not changed, renamed, moved or deleted. Editors can turn this off.",
  },
  {
    mode: "locked",
    icon: Lock,
    description:
      "Like view-only, and only an admin who confirms their password can unlock it. Use it for memories agents must never touch.",
  },
];

function describeOsEffect(
  isFile: boolean,
  platform: string,
  isStrongLockEnabled: boolean,
  mode: ProtectionMode,
): string {
  if (mode === "none") return "";
  if (platform === "win32") {
    return isFile
      ? "Windows marks the file read-only."
      : "Windows marks every file inside read-only. Windows can't stop new files being created in the folder; CMM refuses them and warns when another program adds one.";
  }
  const base = isFile
    ? "The file's write permission is removed on disk, so other programs can't change it either."
    : "Write permission is removed on disk from the folder and everything in it, so other programs (including agents that don't use CMM) can't change, add or delete files.";
  return mode === "locked" && isStrongLockEnabled && !isFile
    ? `${base} Strong lock also sets the macOS immutable flag.`
    : base;
}

/**
 * The Protection tab: None, View-only or Locked for a folder or file, with what each
 * does on disk, its limits, a password prompt when an admin unlocks, and the job's progress for
 * folders. Single files use it from the Properties dialog.
 *
 * @example
 * <ProtectionTab path="persona" />
 */
export function ProtectionTab({ path: entryPath }: { path: string }) {
  const explorer = useExplorer();
  const { storage, userRole } = explorer;
  const queryClient = useQueryClient();
  const { data: protection, refetch } = useProtection(storage.id, entryPath);
  const { setProtection } = useMemoryMutations();
  const [chosenMode, setChosenMode] = useState<ProtectionMode>();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string>();
  const [runningJob, setRunningJob] = useState<JobSummary>();
  const jobState = useJobProgress(runningJob, (finishedJob) => {
    setRunningJob(undefined);
    void refetch();
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.storageDirectories(storage.id) });
    if (finishedJob.status === "done") announce("Protection updated");
    else announceError("Protection didn't change", new Error(finishedJob.error ?? "The job stopped."));
  });

  if (!protection) return <LoadingSkeleton rows={3} label="Loading protection…" />;

  const selectedMode = chosenMode ?? protection.own;
  const isUnlocking = protection.own === "locked" && selectedMode !== "locked";
  const inheritedFrom = protection.source && protection.source.path !== entryPath ? protection.source.path : undefined;
  const changeReason =
    explorer.readOnlyReason ??
    (userRole === "viewer" ? "Viewers can't change protection." : undefined) ??
    (isUnlocking && userRole !== "admin" ? "Only an admin can unlock a locked item." : undefined) ??
    (protection.isBusy || runningJob ? "A protection change is running." : undefined);
  const osEffect = describeOsEffect(
    protection.isFile,
    protection.platform,
    protection.isStrongLockEnabled,
    selectedMode,
  );

  const apply = async () => {
    setPasswordError(undefined);
    try {
      const result = await setProtection.mutateAsync({
        storageId: storage.id,
        path: entryPath,
        mode: selectedMode,
        password: isUnlocking ? password : undefined,
      });
      setPassword("");
      setChosenMode(undefined);
      if (result.job) setRunningJob(result.job);
      else {
        announce("Protection updated");
        void refetch();
      }
    } catch (applyError) {
      if (applyError instanceof ApiError && applyError.status === 401) setPasswordError(applyError.message);
      else announceError("Couldn't change protection", applyError);
    }
  };

  const progress = jobState?.progress;
  return (
    <div className="grid gap-5" data-testid="protection-tab">
      {protection.violation && (
        <div className="flex gap-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm" role="alert">
          <ShieldAlert className="h-5 w-5 flex-none text-danger" aria-hidden />
          <div>
            An external process modified this protected {protection.isFile ? "file" : "folder"} (
            <span className="font-medium">{protection.violation.path}</span>). CMM made it read-only again.
          </div>
        </div>
      )}
      {inheritedFrom && (
        <p
          className="rounded-md border border-line bg-surface-subtle p-3 text-sm text-foreground-muted"
          data-testid="protection-inherited"
        >
          It is already {PROTECTION_LABELS[protection.mode].toLowerCase()} because &ldquo;{inheritedFrom}&rdquo; is. Its
          own setting applies too and wins when it is stricter.
        </p>
      )}
      <div role="radiogroup" aria-label="Protection" className="grid gap-2">
        {MODE_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const isSelected = selectedMode === option.mode;
          return (
            <label
              key={option.mode}
              data-testid={`protection-option-${option.mode}`}
              className={mergeClassNames(
                "flex cursor-pointer gap-3 rounded-md border border-line p-3 hover:border-line-strong",
                isSelected && "border-brand bg-surface-strong",
                changeReason && "cursor-not-allowed",
              )}
            >
              <input
                type="radio"
                name="protection-mode"
                value={option.mode}
                checked={isSelected}
                disabled={changeReason !== undefined && !isSelected}
                onChange={() => setChosenMode(option.mode)}
                className="mt-1"
              />
              <OptionIcon className="mt-0.5 h-5 w-5 flex-none text-foreground-muted" aria-hidden />
              <span>
                <span className="font-medium">
                  {PROTECTION_LABELS[option.mode]}
                  {protection.own === option.mode && (
                    <span className="ml-2 text-xs text-foreground-subtle">(current)</span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm leading-relaxed text-foreground-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {osEffect && (
        <div className="flex gap-2.5 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm leading-relaxed">
          <TriangleAlert className="h-4 w-4 flex-none text-warning" aria-hidden />
          <div>
            {osEffect} Programs running as your OS user can still remove these permissions; CMM will detect and warn.
          </div>
        </div>
      )}
      {isUnlocking && userRole === "admin" && (
        <div>
          <FormLabel htmlFor="protection-password">Your password</FormLabel>
          <PasswordInput
            id="protection-password"
            value={password}
            autoComplete="current-password"
            onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            hasError={passwordError !== undefined}
          />
          <FormErrorMessage message={passwordError} />
        </div>
      )}
      {runningJob && (
        <div data-testid="protection-progress">
          <div className="mb-1 flex justify-between text-xs text-foreground-subtle">
            <span>{runningJob.title}</span>
            <span>
              {progress && progress.total > 0
                ? `${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} items`
                : "Starting…"}
            </span>
          </div>
          <ProgressBar value={progress?.done ?? 0} maximum={Math.max(progress?.total ?? 1, 1)} />
        </div>
      )}
      <div className="flex items-center justify-end gap-3">
        {changeReason && <span className="text-sm text-foreground-subtle">{changeReason}</span>}
        <Button
          variant="primary"
          disabled={
            changeReason !== undefined ||
            selectedMode === protection.own ||
            setProtection.isPending ||
            (isUnlocking && password === "")
          }
          onClick={() => void apply()}
          data-testid="protection-apply"
        >
          {setProtection.isPending ? "Applying…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
