"use client";

import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { FileWarning, KeyRound, Lock, LockKeyholeOpen, RefreshCw, ShieldAlert, ShieldOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { DecryptDialog } from "@/components/encryption/decrypt-dialog";
import { EnableEncryptionWizard } from "@/components/encryption/enable-encryption-wizard";
import { ResumeEncryptionForm } from "@/components/encryption/resume-encryption-form";
import { UnlockPanel } from "@/components/encryption/unlock-panel";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { JobProgressDetails } from "@/components/jobs/job-progress-details";
import { useJobProgress } from "@/hooks/use-job-progress";
import type { EncryptionState, JobSummary } from "@/lib/api-types";
import { useEncryptionMutations, useEncryptionStatus } from "@/lib/client/encryption";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

dayjs.extend(relativeTime);

const STATE_LABELS: Record<EncryptionState, string> = {
  encrypting: "Encrypting…",
  encrypted: "Encrypted",
  decrypting: "Decrypting…",
  rekeying: "Re-keying…",
};

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-foreground-subtle">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

/** A running job's progress (bytes, files, speed, time left), from server events. */
function JobProgressBar({ job, onFinished }: { job: JobSummary; onFinished: () => void }) {
  const jobState = useJobProgress(job, onFinished);
  if (jobState?.status === "paused") return null;
  return (
    <div className="grid gap-2" data-testid="encryption-job-progress">
      <JobProgressDetails
        job={{ ...job, status: jobState?.status ?? job.status, progress: jobState?.progress ?? job.progress }}
      />
      <p className="text-xs text-foreground-subtle">
        This runs in the background: you can close this window and keep working. The folder and the ring in the top bar
        show its progress.
      </p>
    </div>
  );
}

/**
 * The Encryption tab of Folder settings. A plain folder offers "Encrypt this folder…"
 * (the wizard). An encrypted one shows its state, key fingerprint, creation and whether this
 * session has it unlocked (with the time left), plus Lock now, Re-key… and Decrypt permanently…;
 * plaintext files found inside get "Encrypt N files now", and an interrupted job the resume form.
 *
 * @example
 * <EncryptionTab path="persona" />
 */
export function EncryptionTab({ path: folderPath }: { path: string }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const { data: status, refetch } = useEncryptionStatus(storage.id, folderPath);
  const mutations = useEncryptionMutations();
  const [openPanel, setOpenPanel] = useState<"wizard" | "rekey" | "decrypt">();
  const [startedJob, setStartedJob] = useState<JobSummary>();

  if (!status) return <LoadingSkeleton rows={3} label="Loading encryption…" />;
  const writeReason =
    explorer.readOnlyReason ?? (explorer.userRole === "viewer" ? "Viewers can't change encryption." : undefined);
  const refresh = () => {
    setStartedJob(undefined);
    void refetch();
    mutations.refresh(storage.id);
  };

  if (!status.encrypted) {
    return (
      <div className="grid gap-5" data-testid="encryption-tab" data-encrypted="false">
        <div className="flex gap-3">
          <ShieldOff className="mt-0.5 h-5 w-5 flex-none text-foreground-muted" aria-hidden />
          <div className="text-sm leading-relaxed text-foreground-muted">
            This folder is not encrypted. Encrypting it keeps every file inside encrypted on disk with a key only you
            hold, in a key file. To read the files, you unlock the folder with the key file and your password.
          </div>
        </div>
        {(status.blockedReason ?? writeReason) && (
          <p className="rounded-md border border-line bg-surface-subtle p-3 text-sm text-foreground-muted">
            {status.blockedReason ?? writeReason}
          </p>
        )}
        <Button
          variant="primary"
          className="w-fit"
          disabled={status.blockedReason !== undefined || writeReason !== undefined}
          leadingIcon={<KeyRound className="mr-1.5 h-4 w-4" />}
          onClick={() => setOpenPanel("wizard")}
          data-testid="encrypt-folder"
        >
          Encrypt this folder…
        </Button>
        {openPanel === "wizard" && (
          <EnableEncryptionWizard
            storageId={storage.id}
            path={folderPath}
            folderName={status.folderName}
            onClose={() => {
              setOpenPanel(undefined);
              refresh();
            }}
          />
        )}
      </div>
    );
  }

  const isScopeItself = status.scopePath === folderPath;
  const job = startedJob ?? status.job;
  const interruptedState = status.state !== "encrypted" && status.state !== undefined ? status.state : undefined;
  const needsResume = interruptedState !== undefined && (!job || job.status === "paused");
  const lockNow = async () => {
    try {
      await mutations.lock.mutateAsync({ storageId: storage.id, path: status.scopePath });
      announce("Locked", `"${status.folderName}" is locked again.`);
    } catch (lockError) {
      announceError("Couldn't lock", lockError);
    }
  };
  const encryptPlaintext = async () => {
    try {
      const { job: plaintextJob } = await mutations.encryptPlaintext.mutateAsync({
        storageId: storage.id,
        path: status.scopePath,
      });
      setStartedJob(plaintextJob);
    } catch (encryptError) {
      announceError("Couldn't encrypt the files", encryptError);
    }
  };

  return (
    <div className="grid gap-5" data-testid="encryption-tab" data-encrypted="true" data-state={status.state}>
      {!isScopeItself && (
        <p className="rounded-md border border-line bg-surface-subtle p-3 text-sm text-foreground-muted">
          This folder is inside the encrypted folder &ldquo;{status.scopePath}&rdquo;, so it is encrypted with that
          folder&rsquo;s key. Change encryption there.
        </p>
      )}
      {status.weakKey && (
        <div
          className="flex items-start gap-3 rounded-md border border-danger/50 bg-danger/10 p-3 text-sm"
          role="alert"
          data-testid="weak-key-banner"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-none text-danger" aria-hidden />
          <span>
            <strong className="font-medium">This folder&rsquo;s key is not secret.</strong> It was encrypted by a test
            build of CCM that used an empty key, so anyone with CCM could read these files. Choose{" "}
            <strong className="font-medium">Re-key…</strong> below with its key file to protect it with a new key.
          </span>
        </div>
      )}
      <dl>
        <DetailRow label="State">
          <span className="font-medium" data-testid="encryption-state">
            {STATE_LABELS[status.state ?? "encrypted"]}
          </span>
        </DetailRow>
        <DetailRow label="This session">
          {status.unlocked ? (
            <span className="flex items-center gap-1.5 text-success" data-testid="encryption-unlocked">
              <LockKeyholeOpen className="h-4 w-4" aria-hidden />
              Unlocked{status.expiresAt ? `, locks ${dayjs(status.expiresAt).fromNow()}` : ""}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-danger" data-testid="encryption-locked">
              <Lock className="h-4 w-4" aria-hidden />
              Locked
            </span>
          )}
        </DetailRow>
        <DetailRow label="Key">
          <span className="font-mono text-xs">{status.keyFingerprint}</span>
          <span className="ml-2 text-xs text-foreground-subtle">AES-256-GCM, key file only</span>
        </DetailRow>
        {status.createdAt && (
          <DetailRow label="Encrypted">
            {dayjs(status.createdAt).format("MMMM D, YYYY HH:mm")}
            {status.createdBy ? ` by ${status.createdBy}` : ""}
          </DetailRow>
        )}
      </dl>
      {job && job.status !== "paused" && <JobProgressBar key={job.id} job={job} onFinished={refresh} />}
      {needsResume && interruptedState && isScopeItself && (
        <ResumeEncryptionForm
          storageId={storage.id}
          path={folderPath}
          state={interruptedState}
          onResumed={setStartedJob}
        />
      )}
      {status.plaintextFiles > 0 && status.state === "encrypted" && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
          data-testid="plaintext-banner"
        >
          <FileWarning className="h-5 w-5 flex-none text-warning" aria-hidden />
          <span className="flex-1">
            {status.plaintextFiles.toLocaleString()}
            {status.plaintextFilesCapped ? "+" : ""} file{status.plaintextFiles === 1 ? " is" : "s are"} not encrypted
            on disk (written by another program).
          </span>
          <Button
            variant="outline-primary"
            size="small"
            disabled={!status.unlocked || writeReason !== undefined || mutations.encryptPlaintext.isPending}
            title={status.unlocked ? undefined : "Unlock the folder first."}
            onClick={() => void encryptPlaintext()}
            data-testid="encrypt-plaintext"
          >
            Encrypt {status.plaintextFiles.toLocaleString()} file{status.plaintextFiles === 1 ? "" : "s"} now
          </Button>
        </div>
      )}
      {!status.unlocked && !needsResume && (
        <UnlockPanel
          storageId={storage.id}
          path={status.scopePath}
          folderName={status.folderName}
          className="p-0"
          onUnlocked={() => void refetch()}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {status.unlocked && (
          <Button
            variant="outline-secondary"
            leadingIcon={<Lock className="mr-1.5 h-4 w-4" />}
            onClick={() => void lockNow()}
            data-testid="encryption-lock-now"
          >
            Lock now
          </Button>
        )}
        {isScopeItself && (
          <Button
            variant="outline-secondary"
            disabled={status.state !== "encrypted" || writeReason !== undefined}
            leadingIcon={<RefreshCw className="mr-1.5 h-4 w-4" />}
            onClick={() => setOpenPanel("rekey")}
            data-testid="encryption-rekey"
          >
            Re-key…
          </Button>
        )}
      </div>
      {isScopeItself && (
        <section className="rounded-md border border-danger/40 p-4" data-testid="encryption-danger-zone">
          <h4 className="font-medium text-danger">Danger zone</h4>
          <p className="mt-1 text-sm text-foreground-muted">
            Decrypting writes every file back to disk as plaintext. It needs the key file, your password and the
            folder&rsquo;s name.
          </p>
          <Button
            variant="outline-danger"
            className="mt-3"
            disabled={status.state !== "encrypted" || writeReason !== undefined}
            onClick={() => setOpenPanel("decrypt")}
            data-testid="encryption-decrypt"
          >
            Decrypt permanently…
          </Button>
        </section>
      )}
      {openPanel === "rekey" && (
        <EnableEncryptionWizard
          storageId={storage.id}
          path={folderPath}
          folderName={status.folderName}
          mode="rekey"
          onClose={() => {
            setOpenPanel(undefined);
            refresh();
          }}
        />
      )}
      {openPanel === "decrypt" && (
        <DecryptDialog
          storageId={storage.id}
          path={folderPath}
          folderName={status.folderName}
          onStarted={(decryptJob) => {
            setStartedJob(decryptJob);
            void refetch();
          }}
          onClose={() => setOpenPanel(undefined)}
        />
      )}
    </div>
  );
}
