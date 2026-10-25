"use client";

import { AlertTriangle, Eye, Play, Save, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { FolderPicker } from "@/components/explorer/folder-picker";
import { Slideover } from "@/components/interactive/slideover";
import { Button } from "@/components/primitives/button";
import { FormCheckbox, FormSwitch } from "@/components/primitives/form-check";
import { FormErrorMessage, FormHelpText, FormLabel } from "@/components/primitives/form-field";
import { FormInput } from "@/components/primitives/form-input";
import { FormSelect } from "@/components/primitives/form-select";
import { PasswordInput } from "@/components/primitives/password-input";
import { StaticAlert } from "@/components/primitives/static-alert";
import { FormErrorAlert } from "@/components/security/form-error-alert";
import { formatFileSize } from "@/components/page-sections/applications/file-manager/format-file-size";
import type { BackupEndpoint, BackupPreview, BackupProfile, BackupProfileInput, StorageSummary } from "@/lib/api-types";
import {
  BACKUP_MODE_DESCRIPTIONS,
  BACKUP_MODE_LABELS,
  BACKUP_MODES,
  backupProfileInputSchema,
  MIRROR_WARNING,
} from "@/lib/backup";
import { useBackupMutations } from "@/lib/client/backup";
import { readBaseName } from "@/lib/client/query-keys";

/** What the editor starts with: a profile to edit, or endpoints from a drag on the topology. */
export interface ProfileEditorSeed {
  profile?: BackupProfile;
  source?: Partial<BackupEndpoint>;
  destination?: Partial<BackupEndpoint>;
}

function toInput(profile: BackupProfile): BackupProfileInput {
  return {
    name: profile.name,
    source: { storageId: profile.source.storageId, path: profile.source.path },
    destination: { storageId: profile.destination.storageId, path: profile.destination.path },
    mode: profile.mode,
    compare: profile.compare,
    verify: profile.verify,
    includeGit: profile.includeGit,
    excludes: profile.excludes,
    keepSnapshots: profile.keepSnapshots,
    autoRunOnConnect: profile.autoRunOnConnect,
    autoResume: profile.autoResume,
  };
}

function buildInitialInput(seed: ProfileEditorSeed, storages: readonly StorageSummary[]): BackupProfileInput {
  if (seed.profile) return toInput(seed.profile);
  const firstInternal = storages.find((storage) => storage.kind === "internal" && storage.available);
  const firstDrive = storages.find(
    (storage) => storage.kind !== "internal" && storage.available && storage.access === "write",
  );
  return {
    name: "",
    source: { storageId: seed.source?.storageId ?? firstInternal?.id ?? "", path: seed.source?.path ?? "" },
    destination: { storageId: seed.destination?.storageId ?? firstDrive?.id ?? "", path: seed.destination?.path ?? "" },
    mode: "copy",
    compare: "size-mtime",
    verify: false,
    includeGit: true,
    excludes: [],
    keepSnapshots: null,
    autoRunOnConnect: false,
    autoResume: true,
  };
}

function readFieldErrors(input: BackupProfileInput): Record<string, string> {
  const parsed = backupProfileInputSchema.safeParse(input);
  if (parsed.success) return {};
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
  return fieldErrors;
}

function EndpointField({
  idPrefix,
  label,
  endpoint,
  storages,
  errorMessage,
  onChange,
}: {
  idPrefix: string;
  label: string;
  endpoint: BackupEndpoint;
  storages: readonly StorageSummary[];
  errorMessage?: string;
  onChange: (endpoint: BackupEndpoint) => void;
}) {
  const storage = storages.find((candidate) => candidate.id === endpoint.storageId);
  return (
    <div className="grid gap-2">
      <FormLabel htmlFor={`${idPrefix}-storage`}>{label}</FormLabel>
      <FormSelect
        id={`${idPrefix}-storage`}
        value={endpoint.storageId}
        hasError={Boolean(errorMessage)}
        onChange={(changeEvent) => onChange({ storageId: changeEvent.target.value, path: "" })}
      >
        <option value="" disabled>
          Choose a storage
        </option>
        {storages.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.label}
            {candidate.available ? "" : " (not connected)"}
          </option>
        ))}
      </FormSelect>
      {storage?.available ? (
        <FolderPicker
          storageId={storage.id}
          storageLabel={storage.label}
          value={endpoint.path}
          onChange={(folderPath) => onChange({ ...endpoint, path: folderPath })}
          testId={`${idPrefix}-folder-picker`}
        />
      ) : (
        storage && (
          <FormInput
            id={`${idPrefix}-path`}
            value={endpoint.path}
            placeholder="Folder path on the drive (empty for its top level)"
            onChange={(changeEvent) => onChange({ ...endpoint, path: changeEvent.target.value })}
          />
        )
      )}
      <FormErrorMessage message={errorMessage} />
    </div>
  );
}

function PreviewSummary({ preview, isMirror }: { preview: BackupPreview; isMirror: boolean }) {
  return (
    <div className="grid gap-3 rounded-md border border-line p-3 text-sm" data-testid="backup-preview">
      <div className="font-medium">Dry run: nothing was copied</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
        <dt className="text-foreground-subtle">Goes into</dt>
        <dd className="truncate font-mono text-xs" title={preview.targetPath}>
          {preview.targetPath}
        </dd>
        <dt className="text-foreground-subtle">To copy</dt>
        <dd data-testid="preview-copy">
          {preview.copyFiles.toLocaleString()} files, {formatFileSize(preview.copyBytes)}
        </dd>
        <dt className="text-foreground-subtle">Unchanged</dt>
        <dd data-testid="preview-skip">{preview.skipFiles.toLocaleString()} files</dd>
        <dt className="text-foreground-subtle">Free on destination</dt>
        <dd>
          {formatFileSize(preview.freeBytes)} ({preview.fsType})
        </dd>
        {isMirror && (
          <>
            <dt className="text-foreground-subtle">To Trash</dt>
            <dd data-testid="preview-delete-count">{preview.deleteCount.toLocaleString()} items</dd>
          </>
        )}
      </dl>
      {preview.insufficientSpace && (
        <StaticAlert tone="danger" variant="soft">
          Not enough space: this backup needs {formatFileSize(preview.requiredBytes)} free.
        </StaticAlert>
      )}
      {isMirror && preview.deletePaths.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Moved to the destination&rsquo;s Trash</div>
          <ul
            className="max-h-36 overflow-y-auto rounded border border-line font-mono text-xs"
            data-testid="preview-delete-list"
          >
            {preview.deletePaths.map((deletePath) => (
              <li key={deletePath} className="border-b border-line/60 px-2 py-1 last:border-b-0">
                {deletePath}
              </li>
            ))}
          </ul>
          {preview.deleteCount > preview.deletePaths.length && (
            <FormHelpText>
              …and {(preview.deleteCount - preview.deletePaths.length).toLocaleString()} more.
            </FormHelpText>
          )}
        </div>
      )}
      {preview.warnings.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Warnings ({preview.warningCount.toLocaleString()})</div>
          <ul className="max-h-36 overflow-y-auto rounded border border-line text-xs" data-testid="preview-warnings">
            {preview.warnings.map((warning, warningIndex) => (
              <li key={`${warningIndex}-${warning.path}`} className="border-b border-line/60 px-2 py-1 last:border-b-0">
                <span className="font-mono">{warning.path}</span>: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The backup profile editor, a slideover: source and destination (a storage, then a
 * folder), mode with what it does (mirror shows its Trash warning), options (verify, include
 * `.git`, excludes, auto-run on connect, auto-resume, snapshots to keep), a dry-run Preview, and
 * Save or "Save and run". Mirror asks for the password to run, and to save when it runs on its own.
 *
 * @example
 * <ProfileEditor seed={{ destination: { storageId: "ext-USB" } }} storages={storages} onClose={close} onStarted={showJobs} />
 */
export function ProfileEditor({
  seed,
  storages,
  onClose,
  onStarted,
}: {
  seed: ProfileEditorSeed;
  storages: StorageSummary[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const { saveProfile, previewBackup, runBackup } = useBackupMutations();
  const [input, setInput] = useState<BackupProfileInput>(() => buildInitialInput(seed, storages));
  const [password, setPassword] = useState("");
  const [excludeDraft, setExcludeDraft] = useState("");
  const [preview, setPreview] = useState<BackupPreview>();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState<string>();
  const [busyAction, setBusyAction] = useState<"preview" | "save" | "run">();
  const editedProfile = seed.profile;
  const sources = storages.filter((storage) => storage.access === "read" || storage.access === "write");
  const destinations = storages.filter((storage) => storage.access === "write");
  const isMirror = input.mode === "mirror";
  const needsPasswordToSave =
    isMirror && input.autoRunOnConnect && !(editedProfile?.mode === "mirror" && editedProfile.autoRunOnConnect);

  const update = (changes: Partial<BackupProfileInput>) => {
    setInput((current) => ({ ...current, ...changes }));
    setPreview(undefined);
  };

  const readName = () => {
    if (input.name.trim() !== "") return input.name.trim();
    const sourceStorage = storages.find((storage) => storage.id === input.source.storageId);
    const destinationStorage = storages.find((storage) => storage.id === input.destination.storageId);
    return `${readBaseName(input.source.path) || sourceStorage?.label || "Backup"} → ${destinationStorage?.label ?? "drive"}`;
  };

  const validate = (): BackupProfileInput | undefined => {
    const named = { ...input, name: readName() };
    const errors = readFieldErrors(named);
    setFieldErrors(errors);
    return Object.keys(errors).length === 0 ? named : undefined;
  };

  const runAction = async (action: "preview" | "save" | "run") => {
    const validInput = validate();
    if (!validInput) return;
    if ((action === "run" && isMirror) || (action !== "preview" && needsPasswordToSave)) {
      if (password === "") {
        setFieldErrors({ password: "Enter your password to confirm the mirror." });
        return;
      }
    }
    setBusyAction(action);
    setErrorMessage(undefined);
    try {
      if (action === "preview") {
        setPreview(
          await previewBackup.mutateAsync({
            adhoc: {
              source: validInput.source,
              destination: validInput.destination,
              mode: validInput.mode,
              compare: validInput.compare,
              verify: validInput.verify,
              includeGit: validInput.includeGit,
              excludes: validInput.excludes,
              keepSnapshots: validInput.keepSnapshots,
              autoResume: validInput.autoResume,
            },
          }),
        );
        return;
      }
      const saved = await saveProfile.mutateAsync({
        profileId: editedProfile?.id,
        input: validInput,
        password: needsPasswordToSave || (action === "run" && isMirror) ? password : undefined,
      });
      if (action === "run") {
        await runBackup.mutateAsync({ request: { profileId: saved.id }, password: isMirror ? password : undefined });
        onStarted();
      }
      onClose();
    } catch (actionError) {
      setErrorMessage(actionError instanceof Error ? actionError.message : "Something went wrong.");
    } finally {
      setBusyAction(undefined);
    }
  };

  const addExclude = () => {
    const pattern = excludeDraft.trim();
    if (pattern !== "" && !input.excludes.includes(pattern)) update({ excludes: [...input.excludes, pattern] });
    setExcludeDraft("");
  };
  const handleExcludeKey = (keyEvent: KeyboardEvent<HTMLInputElement>) => {
    if (keyEvent.key !== "Enter" && keyEvent.key !== ",") return;
    keyEvent.preventDefault();
    addExclude();
  };

  return (
    <Slideover
      isOpen
      onOpenChange={(isOpen) => !isOpen && busyAction === undefined && onClose()}
      title={editedProfile ? `Edit "${editedProfile.name}"` : "New backup profile"}
      size="large"
    >
      <div className="grid gap-5 p-5" data-testid="backup-profile-editor">
        <FormErrorAlert message={errorMessage} />
        <div className="grid gap-1.5">
          <FormLabel htmlFor="backup-name">Name</FormLabel>
          <FormInput
            id="backup-name"
            value={input.name}
            placeholder={readName()}
            hasError={Boolean(fieldErrors.name)}
            onChange={(changeEvent) => update({ name: changeEvent.target.value })}
          />
          <FormErrorMessage message={fieldErrors.name} />
        </div>

        <EndpointField
          idPrefix="backup-source"
          label="Back up this folder"
          endpoint={input.source}
          storages={sources}
          errorMessage={fieldErrors["source.storageId"] ?? fieldErrors["source.path"]}
          onChange={(source) => update({ source })}
        />
        <EndpointField
          idPrefix="backup-destination"
          label="Into this folder"
          endpoint={input.destination}
          storages={destinations}
          errorMessage={fieldErrors["destination.storageId"] ?? fieldErrors["destination.path"]}
          onChange={(destination) => update({ destination })}
        />
        <FormHelpText className="-mt-3">
          Files go into a folder named after the source inside it
          {input.mode === "snapshot" ? ", with a new dated folder for each snapshot" : ""}.
        </FormHelpText>

        <div className="grid gap-1.5">
          <FormLabel htmlFor="backup-mode">Mode</FormLabel>
          <FormSelect
            id="backup-mode"
            value={input.mode}
            onChange={(changeEvent) => update({ mode: changeEvent.target.value as BackupProfileInput["mode"] })}
          >
            {BACKUP_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {BACKUP_MODE_LABELS[mode]}
              </option>
            ))}
          </FormSelect>
          <FormHelpText>{BACKUP_MODE_DESCRIPTIONS[input.mode]}</FormHelpText>
          {isMirror && (
            <StaticAlert
              tone="warning"
              variant="soft"
              icon={<AlertTriangle className="h-4 w-4" />}
              data-testid="mirror-warning"
            >
              {MIRROR_WARNING}
            </StaticAlert>
          )}
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-1 text-sm font-medium">Options</legend>
          <div className="grid gap-1.5 sm:max-w-xs">
            <FormLabel htmlFor="backup-compare">Unchanged files are found by</FormLabel>
            <FormSelect
              id="backup-compare"
              value={input.compare}
              onChange={(changeEvent) => update({ compare: changeEvent.target.value as BackupProfileInput["compare"] })}
            >
              <option value="size-mtime">Size and modified time (fast)</option>
              <option value="checksum">Contents (reads every file)</option>
            </FormSelect>
          </div>
          <FormCheckbox
            id="backup-verify"
            label="Verify each copy"
            description="Reads every copied file back and compares it with the original."
            checked={input.verify}
            onChange={(changeEvent) => update({ verify: changeEvent.target.checked })}
          />
          <FormCheckbox
            id="backup-include-git"
            label="Include .git folders"
            description="Version history travels with the backup."
            checked={input.includeGit}
            onChange={(changeEvent) => update({ includeGit: changeEvent.target.checked })}
          />
          <div className="grid gap-1.5">
            <FormLabel htmlFor="backup-exclude">Leave out</FormLabel>
            {input.excludes.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="backup-excludes">
                {input.excludes.map((pattern) => (
                  <span
                    key={pattern}
                    className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 font-mono text-xs"
                  >
                    {pattern}
                    <button
                      type="button"
                      aria-label={`Remove ${pattern}`}
                      className="rounded-full hover:text-danger"
                      onClick={() => update({ excludes: input.excludes.filter((existing) => existing !== pattern) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <FormInput
              id="backup-exclude"
              value={excludeDraft}
              placeholder="*.log, node_modules, drafts/**"
              onChange={(changeEvent) => setExcludeDraft(changeEvent.target.value)}
              onKeyDown={handleExcludeKey}
              onBlur={addExclude}
            />
            <FormHelpText>Press Enter to add. A pattern without a slash matches that name anywhere.</FormHelpText>
            <FormErrorMessage message={fieldErrors.excludes} />
          </div>
          {input.mode === "snapshot" && (
            <div className="grid gap-1.5 sm:max-w-xs">
              <FormLabel htmlFor="backup-keep">Snapshots to keep</FormLabel>
              <FormInput
                id="backup-keep"
                type="number"
                min={1}
                max={1000}
                value={input.keepSnapshots ?? ""}
                placeholder="All"
                onChange={(changeEvent) =>
                  update({ keepSnapshots: changeEvent.target.value === "" ? null : Number(changeEvent.target.value) })
                }
              />
              <FormHelpText>Older snapshots go to the destination&rsquo;s Trash.</FormHelpText>
              <FormErrorMessage message={fieldErrors.keepSnapshots} />
            </div>
          )}
          <FormSwitch
            id="backup-auto-run"
            label="Run when the drive is plugged in"
            description="At most once an hour."
            checked={input.autoRunOnConnect}
            onChange={(changeEvent) => update({ autoRunOnConnect: changeEvent.target.checked })}
          />
          <FormSwitch
            id="backup-auto-resume"
            label="Resume when a drive comes back"
            description="A backup paused because a drive was unplugged continues by itself."
            checked={input.autoResume}
            onChange={(changeEvent) => update({ autoResume: changeEvent.target.checked })}
          />
        </fieldset>

        {isMirror && (
          <div className="grid gap-1.5">
            <FormLabel htmlFor="backup-password">Your password</FormLabel>
            <PasswordInput
              id="backup-password"
              value={password}
              autoComplete="current-password"
              hasError={Boolean(fieldErrors.password)}
              onChange={(changeEvent) => setPassword(changeEvent.target.value)}
            />
            <FormHelpText>
              Needed to run a mirror{needsPasswordToSave ? ", and to save one that runs by itself" : ""}.
            </FormHelpText>
            <FormErrorMessage message={fieldErrors.password} />
          </div>
        )}

        {preview && <PreviewSummary preview={preview} isMirror={isMirror} />}

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" disabled={busyAction !== undefined} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Eye className="h-4 w-4" />}
            disabled={busyAction !== undefined}
            onClick={() => void runAction("preview")}
          >
            {busyAction === "preview" ? "Checking…" : "Preview"}
          </Button>
          <Button
            variant="secondary"
            leadingIcon={<Save className="h-4 w-4" />}
            disabled={busyAction !== undefined}
            onClick={() => void runAction("save")}
          >
            {busyAction === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="primary"
            leadingIcon={<Play className="h-4 w-4" />}
            disabled={busyAction !== undefined}
            onClick={() => void runAction("run")}
          >
            {busyAction === "run" ? "Starting…" : "Save and run"}
          </Button>
        </div>
      </div>
    </Slideover>
  );
}
