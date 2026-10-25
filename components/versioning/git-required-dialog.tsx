"use client";

import dayjs from "dayjs";
import { CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Modal, ModalBody, ModalFooter } from "@/components/interactive/modal";
import { Button } from "@/components/primitives/button";
import { FormRadio } from "@/components/primitives/form-check";
import { FormErrorMessage } from "@/components/primitives/form-field";
import { announce, useExplorer } from "@/components/explorer/explorer-context";
import { GitInstallHelp } from "@/components/versioning/git-install-help";
import type { GitDetection } from "@/lib/api-types";
import { useGitStatus, useVersioningMutations, useVersioningStatus } from "@/lib/client/versioning";

function GitCheck({
  git,
  onCheckAgain,
  isChecking,
}: {
  git?: GitDetection;
  onCheckAgain: () => void;
  isChecking: boolean;
}) {
  const isReady = git?.installed === true && !git.outdated;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle p-3 text-sm"
      data-testid="git-check"
      data-installed={git ? String(isReady) : "checking"}
    >
      {git === undefined ? (
        <span className="flex-1 text-foreground-subtle">Looking for Git…</span>
      ) : isReady ? (
        <span className="flex flex-1 items-center gap-2 text-success">
          <CircleCheck className="h-5 w-5" aria-hidden />
          Git {git.version} found
        </span>
      ) : (
        <span className="flex flex-1 items-center gap-2 text-danger">
          <CircleX className="h-5 w-5" aria-hidden />
          {git.installed ? `Git ${git.version} is too old (2.30 or newer is needed)` : "Git not found"}
        </span>
      )}
      <Button
        variant="outline-secondary"
        size="small"
        disabled={isChecking}
        onClick={onCheckAgain}
        leadingIcon={<RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
        data-testid="git-check-again"
      >
        {isChecking ? "Checking…" : "Check again"}
      </Button>
    </div>
  );
}

/**
 * The dialog that always comes before enabling versioning: it says versioning needs Git,
 * shows whether Git was found (with "Check again" and the offline install help), explains what is
 * stored, offers an archived history back, and asks before adopting a folder's existing `.git`.
 * "Enable versioning" stays off until Git is installed.
 *
 * @example
 * <GitRequiredDialog path="persona" onClose={close} />
 */
export function GitRequiredDialog({ path: folderPath, onClose }: { path: string; onClose: () => void }) {
  const { storage } = useExplorer();
  const { data: git, checkAgain } = useGitStatus();
  const { data: status } = useVersioningStatus(storage.id, folderPath);
  const { enable } = useVersioningMutations();
  const [isChecking, setIsChecking] = useState(false);
  const [archiveChoice, setArchiveChoice] = useState<string>("new");
  const [needsAdopt, setNeedsAdopt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const isGitReady = git?.installed === true && !git.outdated;
  const folderName = status?.folderName ?? folderPath;
  const archives = status?.archives ?? [];

  const runEnable = async (options: { adopt?: boolean } = {}) => {
    setErrorMessage(undefined);
    try {
      const result = await enable.mutateAsync({
        storageId: storage.id,
        path: folderPath,
        adopt: options.adopt,
        restoreArchive: archiveChoice === "new" ? undefined : archiveChoice,
      });
      if ("needsAdoptConfirm" in result) {
        setNeedsAdopt(true);
        return;
      }
      announce("Versioning is on", `"${folderName}" keeps every change from now on.`);
      onClose();
    } catch (enableError) {
      setErrorMessage(enableError instanceof Error ? enableError.message : "Something went wrong.");
    }
  };

  return (
    <Modal isOpen onOpenChange={(isOpen) => !isOpen && onClose()} title="Turn on versioning" size="large">
      <ModalBody>
        <div className="grid gap-4 text-sm leading-relaxed" data-testid="git-required-dialog">
          <p>
            Versioning uses <strong>Git</strong>. Git must be installed on this computer (or on the server) for CMM to
            keep history.
          </p>
          <GitCheck
            git={git}
            isChecking={isChecking}
            onCheckAgain={() => {
              setIsChecking(true);
              void checkAgain().finally(() => setIsChecking(false));
            }}
          />
          <GitInstallHelp
            key={git ? String(isGitReady) : "checking"}
            isInitiallyOpen={git !== undefined && !isGitReady}
          />
          <p className="text-foreground-muted">
            <strong className="text-foreground">What is stored:</strong> a <code>.git</code> folder inside &ldquo;
            {folderName}&rdquo; keeps every version, on this computer only. Each save becomes a step you can undo, and
            changes made by other programs are recorded too. Large binary files make the history grow quickly:
            versioning works best for text, like notes and memories.
          </p>
          {archives.length > 0 && !needsAdopt && (
            <fieldset className="grid gap-2" data-testid="restore-archive-choice">
              <legend className="mb-1 font-medium">This folder had versioning before</legend>
              <FormRadio
                id="versioning-new-history"
                name="versioning-archive"
                label="Start a new history"
                checked={archiveChoice === "new"}
                onChange={() => setArchiveChoice("new")}
              />
              {archives.map((archive) => (
                <FormRadio
                  key={archive.name}
                  id={`versioning-archive-${archive.name}`}
                  name="versioning-archive"
                  label={`Restore archived history (${archive.archivedAt ? dayjs(archive.archivedAt).format("MMM D, YYYY HH:mm") : archive.name})`}
                  checked={archiveChoice === archive.name}
                  onChange={() => setArchiveChoice(archive.name)}
                />
              ))}
            </fieldset>
          )}
          {needsAdopt && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-3" data-testid="adopt-confirm">
              This folder already has its own Git history (a <code>.git</code> folder). CMM can keep it and add its own
              commits on top. Nothing in the existing history is changed.
            </div>
          )}
          {status?.blockedReason && (
            <p className="rounded-md border border-line bg-surface-subtle p-3 text-foreground-muted">
              {status.blockedReason}
            </p>
          )}
          <FormErrorMessage message={errorMessage} />
        </div>
      </ModalBody>
      <ModalFooter>
        <Button variant="outline-secondary" onClick={onClose}>
          Cancel
        </Button>
        {needsAdopt ? (
          <Button
            variant="primary"
            className="ml-2"
            disabled={enable.isPending}
            onClick={() => void runEnable({ adopt: true })}
            data-testid="adopt-history"
          >
            Keep its history and enable
          </Button>
        ) : (
          <Button
            variant="primary"
            className="ml-2"
            disabled={!isGitReady || status?.blockedReason !== undefined || enable.isPending}
            onClick={() => void runEnable()}
            data-testid="enable-versioning"
          >
            {enable.isPending ? "Enabling…" : "Enable versioning"}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
