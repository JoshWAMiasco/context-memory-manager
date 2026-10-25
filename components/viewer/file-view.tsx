"use client";

import {
  Copy,
  Download,
  Eye,
  FolderSearch,
  History,
  Info,
  KeyRound,
  MoreHorizontal,
  Pencil,
  Save,
  SquarePen,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { UnlockPanel } from "@/components/encryption/unlock-panel";
import { DropdownMenu, DropdownMenuDivider, DropdownMenuItem } from "@/components/interactive/dropdown-menu";
import { Tooltip } from "@/components/interactive/tooltip";
import { Button } from "@/components/primitives/button";
import { FormInput } from "@/components/primitives/form-input";
import { CodeEditor } from "@/components/editor/code-editor";
import { ConflictDialog } from "@/components/editor/conflict-dialog";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { announce, announceError, useExplorer } from "@/components/explorer/explorer-context";
import { FileIcon } from "@/components/explorer/file-icon";
import { CodeViewer } from "@/components/viewer/code-viewer";
import { ContentError, ContentLoader } from "@/components/viewer/content-loader";
import { CsvViewer } from "@/components/viewer/csv-viewer";
import { ImageViewer } from "@/components/viewer/image-viewer";
import { PdfViewer } from "@/components/viewer/pdf-viewer";
import { MarkdownViewer } from "@/components/viewer/markdown-viewer";
import { PaneAction, PaneHeader } from "@/components/viewer/pane-header";
import { UndoRedoButtons } from "@/components/versioning/undo-redo-buttons";
import { useVersioningStatus } from "@/lib/client/versioning";
import { PlaceholderViewer } from "@/components/viewer/placeholder-viewer";
import { MAX_TEXT_VIEW_BYTES, useFileDocument, type FileDocument } from "@/hooks/use-file-document";
import type { FileEntry, FileStat, ViewerLimits } from "@/lib/api-types";
import { DecryptedImage } from "@/components/viewer/decrypted-image";
import { ApiError } from "@/lib/client/api";
import { isDesktopApp, readFileManagerName, revealInFileManager } from "@/lib/client/desktop";
import { buildRawUrl } from "@/lib/client/fs";
import { readBaseName, readParentPath } from "@/lib/client/query-keys";
import { protectionReason } from "@/lib/client/protection";
import { confirmLeave } from "@/lib/client/unsaved-changes";
import { describeFileKind, readExtension } from "@/lib/file-kinds";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** Images larger than this show the placeholder instead of being decoded. */
const MAX_IMAGE_PREVIEW_BYTES = 50 * 1024 * 1024;
const DEFAULT_LIMITS: ViewerLimits = { maxEditBytes: 5 * 1024 * 1024, csvMaxRows: 50_000 };

type ViewKind = "markdown" | "code" | "csv" | "image" | "pdf" | "placeholder";

interface ViewPlan {
  viewKind: ViewKind;
  /** The editor language id. */
  language?: string;
  /** Whether the content is text CCM can load (markdown, code, text, CSV, SVG source). */
  isText: boolean;
  /** Why the placeholder is shown instead of a preview, when it isn't the file type. */
  placeholderMessage?: string;
}

/** Picks the viewer from the file name and the server's sniff of the first bytes. */
function planView(entry: FileEntry, fileStat: FileStat): ViewPlan {
  const kindInfo = describeFileKind(entry.name);
  const looksBinary = fileStat.sniff?.isBinary === true;
  const tooLargeMessage = "This file is too large to preview. Download it to open it.";
  if (kindInfo.kind === "pdf") return { viewKind: "pdf", isText: false };
  if (kindInfo.kind === "image") {
    if (entry.size > MAX_IMAGE_PREVIEW_BYTES) {
      return { viewKind: "placeholder", isText: false, placeholderMessage: tooLargeMessage };
    }
    return { viewKind: "image", language: kindInfo.language, isText: readExtension(entry.name) === "svg" };
  }
  const isTextKind = ["markdown", "code", "text", "csv"].includes(kindInfo.kind);
  const isSniffedText = kindInfo.kind === "binary" && fileStat.sniff !== undefined && !looksBinary;
  if (!isTextKind && !isSniffedText) return { viewKind: "placeholder", isText: false };
  if (looksBinary) {
    return {
      viewKind: "placeholder",
      isText: false,
      placeholderMessage: "This file looks binary, so it can't be shown as text.",
    };
  }
  if (entry.size > MAX_TEXT_VIEW_BYTES) {
    return { viewKind: "placeholder", isText: false, placeholderMessage: tooLargeMessage };
  }
  const viewKind: ViewKind = kindInfo.kind === "markdown" ? "markdown" : kindInfo.kind === "csv" ? "csv" : "code";
  return { viewKind, language: kindInfo.language, isText: true };
}

function formatMegabytes(bytes: number): string {
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

function ExternalChangeBanner({
  fileDocument,
  fileName,
  onSavedAs,
  onClose,
}: {
  fileDocument: FileDocument;
  fileName: string;
  onSavedAs: (newPath: string) => void;
  onClose: () => void;
}) {
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [newName, setNewName] = useState(fileName);
  const [isSaving, setIsSaving] = useState(false);
  if (!fileDocument.externalChange) return null;

  const handleSaveAs = async (submitEvent: FormEvent<HTMLFormElement>) => {
    submitEvent.preventDefault();
    setIsSaving(true);
    const newPath = await fileDocument.saveAs(newName.trim());
    setIsSaving(false);
    if (newPath) onSavedAs(newPath);
  };

  const isRemoved = fileDocument.externalChange === "removed";
  return (
    <div
      role="alert"
      data-testid="external-change-banner"
      data-change={fileDocument.externalChange}
      className="flex flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2 text-sm"
    >
      <TriangleAlert className="h-4 w-4 flex-none text-warning" aria-hidden />
      <span className="flex-1">{isRemoved ? "File was removed or moved." : "This file changed on disk."}</span>
      {isRemoved ? (
        isSaveAsOpen ? (
          <form onSubmit={(submitEvent) => void handleSaveAs(submitEvent)} className="flex items-center gap-2">
            <FormInput
              value={newName}
              autoFocus
              aria-label="New file name"
              onChange={(changeEvent) => setNewName(changeEvent.target.value)}
              className="h-8 w-56 text-sm"
            />
            <Button type="submit" variant="primary" size="small" disabled={isSaving || newName.trim() === ""}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline-secondary" size="small" onClick={() => setIsSaveAsOpen(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <>
            {fileDocument.isEditable && (
              <Button
                variant="outline-primary"
                size="small"
                onClick={() => setIsSaveAsOpen(true)}
                data-testid="external-save-as"
              >
                Save as…
              </Button>
            )}
            <Button variant="outline-secondary" size="small" onClick={onClose} data-testid="external-close">
              Close
            </Button>
          </>
        )
      ) : (
        <>
          <Button
            variant="outline-danger"
            size="small"
            onClick={() => fileDocument.reload()}
            data-testid="external-reload"
          >
            Reload
          </Button>
          <Button
            variant="outline-secondary"
            size="small"
            onClick={fileDocument.dismissExternalChange}
            data-testid="external-keep"
          >
            Keep mine
          </Button>
          <Button
            variant="outline-primary"
            size="small"
            onClick={() => fileDocument.openConflict({ reason: "external-change" })}
            data-testid="external-compare"
          >
            Compare
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The Save button. While saving it shows "Saving… N%" for large files; an encrypted file says
 * "Encrypting & saving… N%", then "Verifying…" once the upload is done and the server checks the
 * new ciphertext.
 */
function SaveButton({ fileDocument, isEncrypted }: { fileDocument: FileDocument; isEncrypted: boolean }) {
  const { saveProgress } = fileDocument;
  const savePercent =
    saveProgress?.total && saveProgress.total > 0
      ? Math.round((saveProgress.loaded / saveProgress.total) * 100)
      : undefined;
  const savingLabel = isEncrypted ? "Encrypting & saving…" : "Saving…";
  const label = !fileDocument.isSaving
    ? "Save"
    : isEncrypted && savePercent === 100
      ? "Verifying…"
      : savePercent === undefined
        ? savingLabel
        : `${savingLabel} ${savePercent}%`;
  return (
    <Tooltip content={fileDocument.isDirty ? "Save (Cmd/Ctrl+S)" : "No unsaved changes"}>
      <Button
        variant={fileDocument.isDirty ? "primary" : "outline-secondary"}
        size="small"
        className="ml-1"
        disabled={!fileDocument.isDirty || fileDocument.isSaving}
        onClick={() => void fileDocument.save()}
        data-testid="pane-save"
        data-dirty={fileDocument.isDirty}
        leadingIcon={
          fileDocument.isSaving ? (
            <span
              className="mr-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )
        }
      >
        {label}
        {fileDocument.isDirty && !fileDocument.isSaving && (
          <span
            className="ml-1.5 h-2 w-2 rounded-full bg-warning"
            aria-label="Unsaved changes"
            data-testid="dirty-dot"
          />
        )}
      </Button>
    </Tooltip>
  );
}

/**
 * The selected file: the header with Edit/View, Save, Download, Rename, Trash and More,
 * and the viewer or editor the file's kind calls for. Text content is loaded and saved by
 * `useFileDocument`; changes on disk show a banner, and save conflicts open the conflict dialog.
 *
 * @example
 * <FileView key={`${storageId}:${entry.path}`} entry={entry} fileStat={fileStat} />
 */
export function FileView({ entry, fileStat }: { entry: FileEntry; fileStat: FileStat }) {
  const explorer = useExplorer();
  const { storage } = explorer;
  const limits = fileStat.limits ?? DEFAULT_LIMITS;
  const viewPlan = planView(entry, fileStat);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [hasImageFailed, setHasImageFailed] = useState(false);
  const [pdfFailure, setPdfFailure] = useState<string>();
  const isSvg = viewPlan.viewKind === "image" && viewPlan.isText;
  const encryption = entry.badges.encryption;
  const isEncryptedFile = encryption !== undefined && encryption.plaintext !== true;
  const isFolderLocked = isEncryptedFile && !encryption.unlocked;

  const { data: versioning } = useVersioningStatus(storage.id, entry.path);
  const fileDocument = useFileDocument({
    storageId: storage.id,
    path: entry.path,
    size: entry.size,
    etag: fileStat.etag,
    isUtf8: fileStat.sniff?.isUtf8 !== false,
    maxEditBytes: limits.maxEditBytes,
    isEnabled: viewPlan.isText && (!isSvg || mode === "edit"),
    isEncrypted: isEncryptedFile,
    isLocked: isFolderLocked,
  });
  const isLockedOnServer =
    fileDocument.status === "error" &&
    fileDocument.loadError instanceof ApiError &&
    fileDocument.loadError.code === "ENCRYPTED_LOCKED";

  const writeReason =
    explorer.readOnlyReason ??
    (fileStat.permissions.write ? undefined : (fileStat.permissions.reason ?? "You can't change this file.")) ??
    protectionReason(entry);
  const predictedReadOnlyReason =
    fileStat.sniff?.isUtf8 === false
      ? "Encoding not supported for editing."
      : entry.size > limits.maxEditBytes
        ? `Files over ${formatMegabytes(limits.maxEditBytes)} open view-only.`
        : undefined;
  const editDisabledReason = !viewPlan.isText
    ? "This kind of file can't be edited here."
    : isFolderLocked
      ? "Unlock the folder to edit this file."
      : (writeReason ?? fileDocument.readOnlyReason ?? predictedReadOnlyReason);
  const isEditing = mode === "edit" && editDisabledReason === undefined;
  const busyReason = fileDocument.isDirty ? "Save or discard your changes first." : undefined;

  const download = () => void explorer.download(entry.path);
  const leaveEditMode = () => confirmLeave(() => setMode("view"));

  const { isDirty, save } = fileDocument;
  useEffect(() => {
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (!(keyEvent.metaKey || keyEvent.ctrlKey) || keyEvent.altKey || keyEvent.key.toLowerCase() !== "s") return;
      if (keyEvent.defaultPrevented) return;
      keyEvent.preventDefault();
      if (isEditing && isDirty) void save();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, isEditing, save]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(entry.path);
      announce("Path copied", entry.path);
    } catch {
      announce("Copying isn't allowed here");
    }
  };

  const reveal = async () => {
    try {
      if (!(await revealInFileManager(storage.id, entry.path))) announce("It is no longer on disk");
    } catch (revealError) {
      announceError("Couldn't reveal it", revealError);
    }
  };

  let body: ReactNode;
  const placeholder = (message?: string) => <PlaceholderViewer entry={entry} message={message} onDownload={download} />;
  if ((isFolderLocked || isLockedOnServer) && encryption) {
    body = (
      <UnlockPanel
        storageId={storage.id}
        path={entry.path}
        folderName={readBaseName(encryption.scopePath) || storage.label}
        message={
          fileDocument.hasLockedDraft
            ? "Folder locked — unlock to save your changes. They are kept in this tab for up to 10 minutes."
            : undefined
        }
        onUnlocked={() => {
          if (isLockedOnServer) fileDocument.reload();
        }}
      />
    );
  } else if (viewPlan.viewKind === "placeholder") {
    body = placeholder(viewPlan.placeholderMessage);
  } else if (viewPlan.viewKind === "pdf") {
    body =
      pdfFailure === undefined ? (
        <PdfViewer
          source={`${buildRawUrl(storage.id, entry.path)}&v=${encodeURIComponent(fileStat.etag)}`}
          onFail={setPdfFailure}
        />
      ) : (
        placeholder(pdfFailure)
      );
  } else if (viewPlan.viewKind === "image" && !isEditing) {
    body = hasImageFailed ? (
      placeholder("This image couldn't be shown. It may be damaged or in a format the browser can't read.")
    ) : isEncryptedFile ? (
      <DecryptedImage
        key={fileStat.etag}
        entry={entry}
        source={`${buildRawUrl(storage.id, entry.path)}&v=${encodeURIComponent(fileStat.etag)}`}
        onFail={() => setHasImageFailed(true)}
      />
    ) : (
      <ImageViewer
        source={`${buildRawUrl(storage.id, entry.path)}&v=${encodeURIComponent(fileStat.etag)}`}
        name={entry.name}
        onFail={() => setHasImageFailed(true)}
      />
    );
  } else if (fileDocument.status === "loading") {
    body = (
      <ContentLoader
        entry={entry}
        variant={viewPlan.viewKind === "csv" ? "table" : "text"}
        progress={fileDocument.progress}
        label={isEncryptedFile ? "Decrypting…" : undefined}
        onCancel={fileDocument.cancelLoad}
      />
    );
  } else if (fileDocument.status === "error") {
    body = <ContentError error={fileDocument.loadError} onRetry={() => fileDocument.reload()} onDownload={download} />;
  } else if (isEditing) {
    body =
      viewPlan.viewKind === "markdown" ? (
        <MarkdownEditor
          content={fileDocument.content}
          onChange={fileDocument.setContent}
          onSave={() => void fileDocument.save()}
          storageId={storage.id}
          filePath={entry.path}
          lineEnding={fileDocument.lineEnding}
        />
      ) : (
        <CodeEditor
          content={fileDocument.content}
          onChange={fileDocument.setContent}
          onSave={() => void fileDocument.save()}
          language={viewPlan.language}
          fileName={entry.name}
          lineEnding={fileDocument.lineEnding}
        />
      );
  } else if (viewPlan.viewKind === "markdown") {
    body = (
      <div className="min-h-0 flex-1 overflow-auto">
        <MarkdownViewer content={fileDocument.content} filePath={entry.path} />
      </div>
    );
  } else if (viewPlan.viewKind === "csv") {
    body = <CsvViewer content={fileDocument.content} entry={entry} maxRows={limits.csvMaxRows} />;
  } else {
    body = (
      <CodeViewer
        content={fileDocument.content}
        language={viewPlan.language}
        fileName={entry.name}
        lineEnding={fileDocument.lineEnding}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="file-view" data-mode={mode}>
      <PaneHeader
        entry={entry}
        title={entry.name}
        icon={<FileIcon entry={entry} />}
        extra={
          isEncryptedFile && !isFolderLocked ? (
            <span className="ml-1.5 inline-flex items-center gap-1 text-success" data-testid="encrypted-file-badge">
              · <KeyRound className="h-3 w-3" aria-hidden /> Encrypted · edits are re-encrypted on save
            </span>
          ) : undefined
        }
      >
        {viewPlan.isText &&
          (isEditing ? (
            <Tooltip content="Back to the viewer">
              <Button
                variant="outline-secondary"
                size="small"
                onClick={leaveEditMode}
                data-testid="pane-view"
                leadingIcon={<Eye className="mr-1.5 h-3.5 w-3.5" />}
              >
                View
              </Button>
            </Tooltip>
          ) : (
            <Tooltip content={editDisabledReason ?? "Edit this file"}>
              <Button
                variant="outline-primary"
                size="small"
                aria-disabled={editDisabledReason !== undefined}
                className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                onClick={() => editDisabledReason === undefined && setMode("edit")}
                data-testid="pane-edit"
                leadingIcon={<SquarePen className="mr-1.5 h-3.5 w-3.5" />}
              >
                Edit
              </Button>
            </Tooltip>
          ))}
        {isEditing && !isFolderLocked && <SaveButton fileDocument={fileDocument} isEncrypted={isEncryptedFile} />}
        <span className="mx-1 h-5 w-px bg-line/70" aria-hidden />
        <UndoRedoButtons path={entry.path} busyReason={busyReason} />
        {versioning?.versioned && (
          <PaneAction
            label="Version history"
            icon={History}
            testId="pane-history"
            onClick={() => explorer.openHistory(entry.path)}
          />
        )}
        <PaneAction label="Download" icon={Download} testId="pane-download" onClick={download} />
        <PaneAction
          label="Rename"
          icon={Pencil}
          testId="pane-rename"
          disabledReason={writeReason ?? busyReason}
          onClick={() => explorer.openDialog({ kind: "rename", path: entry.path })}
        />
        <PaneAction
          label="Move to Trash"
          icon={Trash2}
          testId="pane-delete"
          disabledReason={writeReason ?? busyReason}
          onClick={() => explorer.openDialog({ kind: "delete", paths: [entry.path] })}
        />
        <DropdownMenu
          menuClassName="w-52"
          triggerClassName="h-8 w-8 justify-center rounded-md text-foreground-muted hover:bg-surface-muted hover:text-brand"
          triggerLabel="More actions"
          trigger={
            <span data-testid="pane-more">
              <MoreHorizontal className="h-4 w-4 stroke-[1.5]" />
            </span>
          }
        >
          <DropdownMenuItem onSelect={() => void copyPath()} icon={<Copy className="mr-2 h-4 w-4" />}>
            Copy path
          </DropdownMenuItem>
          {explorer.mode === "desktop" && (
            <DropdownMenuItem
              isDisabled={!isDesktopApp()}
              onSelect={() => void reveal()}
              icon={<FolderSearch className="mr-2 h-4 w-4" />}
            >
              Reveal in {readFileManagerName()}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => explorer.openDialog({ kind: "properties", path: entry.path })}
            icon={<Info className="mr-2 h-4 w-4" />}
          >
            Properties
          </DropdownMenuItem>
          <DropdownMenuDivider />
          <DropdownMenuItem
            isDisabled={!versioning?.versioned}
            onSelect={() => explorer.openHistory(entry.path)}
            icon={<History className="mr-2 h-4 w-4" />}
          >
            {versioning?.versioned ? "Version history" : "Version history (versioning is off)"}
          </DropdownMenuItem>
        </DropdownMenu>
      </PaneHeader>
      <ExternalChangeBanner
        fileDocument={fileDocument}
        fileName={entry.name}
        onSavedAs={(newPath) => explorer.selectPath(newPath)}
        onClose={() => {
          fileDocument.discard();
          explorer.selectPath(readParentPath(entry.path));
        }}
      />
      {fileDocument.readOnlyReason && fileDocument.status === "ready" && (
        <div
          className={mergeClassNames(
            "flex items-center gap-2 border-b border-line/60 bg-surface-subtle px-5 py-1.5 text-xs text-foreground-muted",
          )}
          data-testid="read-only-notice"
        >
          <Info className="h-3.5 w-3.5" aria-hidden />
          View-only: {fileDocument.readOnlyReason}
        </div>
      )}
      <div
        className={mergeClassNames(
          "flex min-h-0 flex-1 flex-col",
          isEncryptedFile && fileDocument.isSaving && "pointer-events-none opacity-70",
        )}
        inert={isEncryptedFile && fileDocument.isSaving}
      >
        {body}
      </div>
      {fileDocument.conflict && (
        <ConflictDialog
          fileDocument={fileDocument}
          fileName={readBaseName(entry.path)}
          language={viewPlan.language}
          startsInCompare={fileDocument.conflict.reason === "external-change"}
        />
      )}
    </div>
  );
}
