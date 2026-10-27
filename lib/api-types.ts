/*
 * Types shared by the API route handlers and the browser client. Isomorphic: no server-only
 * imports here.
 */
import type { SniffResult } from "@/lib/file-kinds";
import type { MemoryColor, MemoryIcon } from "@/lib/memory";

export type ApiErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "SETUP_CODE_INVALID"
  | "PASSWORD_CHANGE_REQUIRED"
  | "PROTECTED_VIEW_ONLY"
  | "PROTECTED_LOCKED"
  | "ENCRYPTED_LOCKED"
  | "ENCRYPTION_IN_PROGRESS"
  | "PATH_OUTSIDE_STORAGE"
  | "NOT_FOUND"
  | "ALREADY_EXISTS"
  | "SETUP_COMPLETE"
  | "LAST_ADMIN"
  | "GIT_NOT_INSTALLED"
  | "NESTED_SCOPE"
  | "UNDO_CONFLICT"
  | "ETAG_MISMATCH"
  | "TOO_LARGE_TO_EDIT"
  | "SESSION_LOCKED"
  | "STEP_UP_REQUIRED"
  | "RATE_LIMITED"
  | "BINARY_FILE"
  | "DRIVE_BUSY"
  | "DRIVE_COMMAND_FAILED"
  | "INSUFFICIENT_SPACE"
  | "UPLOAD_OFFSET_MISMATCH"
  | "CONTAINS_MOUNT_POINT"
  | "CONTAINS_PROTECTED"
  | "SCOPE_BUSY"
  | "WRONG_KEY_FILE"
  | "KEY_FILE_PASSPHRASE_REQUIRED"
  | "WRONG_PASSPHRASE"
  | "CRYPTO_AUTH_FAILED"
  | "DECRYPT_CONFIRM_REQUIRED"
  | "VERSIONING_ENCRYPTION_CONFLICT"
  | "GIT_COMMAND_FAILED"
  | "BACKUP_RUNNING"
  | "TOO_MANY_TERMINALS"
  | "OFFICE_UNAVAILABLE"
  | "OFFICE_CONVERSION_FAILED"
  | "OFFICE_TIMEOUT"
  | "ENCRYPTED_NOT_CONVERTED"
  | "TOO_LARGE"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthResponse {
  ok: boolean;
  version: string;
  mode: "desktop" | "server";
  sqlite: string;
  argon2: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  mustChangePassword: boolean;
}

export interface StepUpStatus {
  /** How the current client confirms sensitive actions: never, once per session, or every time. */
  mode: "none" | "lan-once" | "per-action";
  lanConfirmed: boolean;
  actions: string[];
}

export interface MeResponse {
  user: AuthUser;
  mode: "desktop" | "server";
  locked: boolean;
  autoLockSeconds: number;
  stepUp: StepUpStatus;
}

export interface SetupStatusResponse {
  complete: boolean;
  needsSetupCode: boolean;
  mode: "desktop" | "server";
}

export interface UserSummary {
  id: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  disabled: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  lastActivityAt: string;
  ip: string | null;
  userAgent: string | null;
  networkClass: "desktop" | "loopback" | "lan" | "remote";
  locked: boolean;
}

export type JobStatus = "queued" | "running" | "paused" | "done" | "failed" | "cancelled";

export interface JobProgress {
  done: number;
  total: number;
  unit: "bytes" | "files" | "items";
  /** Files done and in total, next to byte progress (encryption jobs). */
  files?: { done: number; total: number };
  currentItem?: string;
  speed?: number;
  eta?: number;
  /** What a backup is doing now. */
  phase?: BackupPhase;
}

/** `GET /api/versioning/git-status`: whether git is installed for versioning. */
export interface GitDetection {
  installed: boolean;
  /** Installed, but older than the minimum (2.30). */
  outdated: boolean;
  version?: string;
  path?: string;
  checkedAt: string;
}

export type HistoryCommitKind = "change" | "undo" | "redo" | "restore" | "external" | "enable" | "replace";

/** One commit of a versioned folder. */
export interface HistoryCommit {
  sha: string;
  short: string;
  message: string;
  author: string;
  /** ISO time. */
  date: string;
  filesChanged: number;
  kind: HistoryCommitKind;
}

/** `GET /api/versioning/log`: newest first; `nextCursor` reads the next page. */
export interface HistoryPage {
  /** The versioned folder. */
  scopePath: string;
  commits: HistoryCommit[];
  nextCursor?: number;
}

export interface CommitFile {
  status: "A" | "M" | "D" | "R";
  /** Storage-relative path. */
  path: string;
  /** Before a rename. */
  oldPath?: string;
}

/** `GET /api/versioning/commit/[sha]`. */
export interface CommitDetail {
  commit: HistoryCommit;
  files: CommitFile[];
}

/** `GET /api/versioning/diff`: a file before and after a commit (decrypted in memory for encrypted folders). */
export interface FileDiff {
  path: string;
  binary: boolean;
  /** Either side over 2 MB is shown like a binary file, with sizes. */
  tooLarge?: boolean;
  before?: string;
  after?: string;
  /** Sizes in bytes; absent when the file didn't exist on that side. */
  beforeSize?: number;
  afterSize?: number;
}

/** A history kept when versioning was turned off. */
export interface VersioningArchive {
  name: string;
  archivedAt?: string;
}

/** What Undo and Redo would do, for the buttons and their tooltips. */
export interface UndoRedoPeek {
  canUndo: boolean;
  undoLabel?: string;
  undoAt?: string;
  canRedo: boolean;
  redoLabel?: string;
  redoAt?: string;
  /** Why both are off right now (protected, locked, a job running). */
  blockedReason?: string;
}

/** `GET /api/versioning/status`. */
export interface VersioningStatus {
  /** The entry is in a versioned folder (or is one). */
  versioned: boolean;
  /** The versioned folder, or the entry itself when it isn't versioned. */
  scopePath: string;
  folderName: string;
  enabledAt?: string;
  enabledBy?: string;
  adopted?: boolean;
  commitCount?: number;
  /** Size of `.git` on disk. */
  gitSizeBytes?: number;
  /** The folder has a `.git` of its own that enabling would adopt. */
  hasGitFolder: boolean;
  archives: VersioningArchive[];
  peek?: UndoRedoPeek;
  /** Why versioning can't be turned on here right now. */
  blockedReason?: string;
}

export interface JobTarget {
  storageId: string;
  path: string;
}

export interface JobSummary {
  id: string;
  type: string;
  status: JobStatus;
  progress: JobProgress;
  /** What the job works on, for people ("Copy 3 items to Backups/2026"). */
  title: string;
  /** The folder the job works on (an encrypted folder being encrypted or decrypted). */
  target?: JobTarget;
  /** Folders the job keeps busy until it ends: the source and destination folders of a move. */
  locks?: JobTarget[];
  /** Where a backup reads and writes, so the Backup page can draw it. */
  transfer?: JobTransfer;
  /** Why it failed, or why it is paused ("Drive disconnected — …"). */
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type StorageKind = "internal" | "external" | "usb";
export type StorageAccessLevel = "read" | "write";

export interface StorageSummary {
  id: string;
  kind: StorageKind;
  label: string;
  /** False for a known external drive that is plugged in but not mounted, or an internal root that is missing. */
  available: boolean;
  access: StorageAccessLevel;
  hidden: boolean;
  /** Capacity in bytes, when known. */
  size?: number;
  used?: number;
  /** Absolute root path; sent to admins only. */
  rootPath?: string;
  /** For external drives: whether CMM can mount it (Linux with udisks2) or eject it. */
  canMount?: boolean;
  canEject?: boolean;
  /** The drive's file system ("exfat", "vfat", "apfs"…), for external drives. */
  fsType?: string;
  /** Why nothing can be written to it, for a drive mounted read-only (`access` is then "read"). */
  readOnlyReason?: string;
}

/** A storage as admins see it in settings, including remembered drives that are unplugged. */
export interface RegisteredStorage {
  id: string;
  kind: StorageKind;
  label: string;
  rootPath: string;
  hidden: boolean;
  /** For drives: plugged in right now. Internal storages are always connected. */
  isConnected: boolean;
}

/** One user's access to one storage, for the user's access matrix. */
export interface UserStorageAccess {
  storageId: string;
  label: string;
  kind: StorageKind;
  /** The explicit grant. */
  level: StorageAccessLevel | "none";
  /** What the user can actually do (admins always write; viewers never write). */
  effectiveLevel: StorageAccessLevel | "none";
}

export interface StorageAccessEntry {
  userId: string;
  username: string;
  role: "admin" | "editor" | "viewer";
  level: StorageAccessLevel | "none";
}

export type FileEntryType = "file" | "directory";

/**
 * `spreadsheet` (xlsx) and `document` (docx) are shown by viewers in the browser; `office` (pptx,
 * the older doc/xls/ppt, OpenDocument, RTF) through LibreOffice on the server, as a PDF.
 */
export type FileKind =
  | "markdown"
  | "code"
  | "text"
  | "csv"
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "spreadsheet"
  | "document"
  | "office"
  | "archive"
  | "binary";

export interface FileBadges {
  isMemory: boolean;
  /** The effective protection: the entry's own, or the strictest of its parent folders'. */
  protection: "none" | "view-only" | "locked";
  /** Set when `protection` isn't "none": "self" when set on this entry, "inherited" from a parent folder. */
  protectionSource?: "self" | "inherited";
  /** Inside an encrypted folder (or the folder itself). */
  encrypted: boolean;
  versioned: boolean;
  /** Set when `encrypted`: the encrypted folder and whether this session has unlocked it. */
  encryption?: EncryptionBadge;
  /** A memory folder's display name, icon and colour. */
  memory?: { name: string; icon?: MemoryIcon; color?: MemoryColor };
}

export type EncryptionState = "encrypting" | "encrypted" | "decrypting" | "rekeying";

export interface EncryptionBadge {
  /** Storage-relative path of the encrypted folder. */
  scopePath: string;
  folderId: string;
  state: EncryptionState;
  /** Unlocked for this session. */
  unlocked: boolean;
  /** A file inside the encrypted folder that is still plaintext on disk (written by another program). */
  plaintext?: boolean;
}

/** `GET /api/crypto/status`: an entry's encrypted folder and this session's unlock. */
export interface EncryptionStatus {
  encrypted: boolean;
  /** The folder whose settings these are (the path itself, or the encrypted folder around it). */
  scopePath: string;
  folderName: string;
  folderId?: string;
  state?: EncryptionState;
  unlocked: boolean;
  /** When the unlock ends (ISO). */
  expiresAt?: string;
  /** A short fingerprint of the key id, to tell key files apart. */
  keyFingerprint?: string;
  /**
   * The folder's key is all zeros: early development builds of CMM stored the
   * wizard's key after wiping it. Anyone can decrypt such a folder until it is re-keyed.
   */
  weakKey?: boolean;
  createdAt?: string;
  createdBy?: string;
  /** Files inside that are still plaintext on disk; `plaintextFilesCapped` when counting stopped early. */
  plaintextFiles: number;
  plaintextFilesCapped?: boolean;
  /** The encryption job working on this folder (queued, running or paused). */
  job?: JobSummary;
  /** Why encryption can't be turned on here (protected, nested…); only when not encrypted. */
  blockedReason?: string;
}

/** One row of Settings → Encryption (`GET /api/crypto/scopes`). */
export interface EncryptedFolderSummary {
  storageId: string;
  storageLabel: string;
  path: string;
  folderName: string;
  state: EncryptionState;
  unlocked: boolean;
  expiresAt?: string;
  available: boolean;
}

export interface FileEntry {
  name: string;
  /** POSIX path relative to the storage root. */
  path: string;
  type: FileEntryType;
  size: number;
  mtimeMs: number;
  /** Creation time where the file system records it, else the change time. */
  createdMs: number;
  kind: FileKind | "folder";
  hasChildren: boolean;
  badges: FileBadges;
}

export interface DirectoryListing {
  storageId: string;
  path: string;
  entries: FileEntry[];
  /** Present when the folder has more entries; pass it back as `cursor`. */
  nextCursor?: string;
}

/** One quick-search match (`GET /api/fs/search`): a file or folder whose name holds the query. */
export interface SearchMatch {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface SearchResults {
  storageId: string;
  query: string;
  /** Shallow matches first, then by path. */
  matches: SearchMatch[];
  /** False when the search stopped early (result, entry or time limit): there may be more. */
  isComplete: boolean;
}

export interface FileStat {
  entry: FileEntry;
  etag: string;
  permissions: { read: boolean; write: boolean; reason?: string };
  /** Files only: what the first 8 KB say (binary, BOM, UTF-8, line endings). */
  sniff?: SniffResult;
  /** The viewer and editor limits an admin set (`/api/fs/stat` only). */
  limits?: ViewerLimits;
}

/** Admin settings `editor.maxEditBytes` and `viewer.csvMaxRows`. */
export interface ViewerLimits {
  /** Larger text files open view-only. */
  maxEditBytes: number;
  /** The CSV viewer stops parsing after this many rows. */
  csvMaxRows: number;
}

/** A folder's or file's protection as the Folder settings panel shows it (`GET /api/protection`). */
export interface ProtectionState {
  /** The effective mode: the entry's own or a parent folder's, whichever is stricter. */
  mode: "none" | "view-only" | "locked";
  /** Where the effective mode is set (storage-relative), when it isn't "none". */
  source?: { path: string; isFile: boolean };
  /** The mode set on this entry itself. */
  own: "none" | "view-only" | "locked";
  isFile: boolean;
  setBy?: string;
  setAt?: string;
  /** The last change another program made inside, until dismissed. */
  violation?: { at: string; path: string };
  /** A protection change is running on it. */
  isBusy: boolean;
  /** The server's OS: Windows can't make folders read-only. */
  platform: "darwin" | "linux" | "win32" | "other";
  /** macOS "Strong lock" (`chflags uchg`) is on for locked folders. */
  isStrongLockEnabled: boolean;
}

export type LineEnding = "lf" | "crlf";

export interface TextFileResponse {
  content: string;
  etag: string;
  lineEnding: LineEnding;
  encoding: "utf-8" | "utf-8-bom";
}

export interface UploadSession {
  uploadId: string;
  chunkSize: number;
  received: number;
  size: number;
}

/** What a replace left to compare with: its commit (versioned folder) or the old version's trash copy. */
export interface ReplaceResult {
  commitSha?: string;
  trashItemId?: string;
}

export interface TrashItem {
  id: string;
  storageId: string;
  storageLabel: string;
  name: string;
  originalPath: string;
  deletedAt: string;
  deletedBy: string | null;
  size: number;
  isDir: boolean;
  encrypted: boolean;
  memory: boolean;
}

export interface TrashListResponse {
  items: TrashItem[];
  totalSize: number;
}

export type BackupMode = "copy" | "mirror" | "snapshot";
export type BackupCompare = "size-mtime" | "checksum";
export type BackupPhase = "scanning" | "copying" | "verifying" | "deleting" | "done";

/** A folder in a storage that a backup reads from or writes to. */
export interface BackupEndpoint {
  storageId: string;
  path: string;
}

/**
 * A memory backup: folders of the source storage gathered into a new memory folder inside the
 * destination, one folder each.
 */
export interface BackupMemory {
  /** The memory's name; its folder inside the destination is named after it. */
  name: string;
  /** The folders backed up, relative to the source storage. */
  paths: string[];
}

/** The source and destination of a running backup job, for the Backup page's topology. */
export interface JobTransfer {
  source: BackupEndpoint;
  destination: BackupEndpoint;
  mode: BackupMode;
  profileId?: string;
  memory?: BackupMemory;
}

/** How a backup runs: what it compares, checks and leaves out. */
export interface BackupOptions {
  compare: BackupCompare;
  verify: boolean;
  includeGit: boolean;
  /** Globs (`*.log`, `node_modules`, `drafts/**`) matched against paths inside the source. */
  excludes: string[];
  /** Snapshot mode: keep this many snapshots; older ones go to the destination's trash. */
  keepSnapshots: number | null;
}

/** A saved backup. */
export interface BackupProfile extends BackupOptions {
  id: string;
  name: string;
  source: BackupEndpoint & { label: string; available: boolean };
  destination: BackupEndpoint & { label: string; available: boolean };
  mode: BackupMode;
  /** A memory backup: the folders it gathers (the source's own path is unused) and the memory's name. */
  memory?: BackupMemory;
  autoRunOnConnect: boolean;
  autoResume: boolean;
  lastRunAt: string | null;
  lastRun?: BackupRunSummary;
  createdAt: string;
  updatedAt: string;
}

/** What `POST /api/backup/profiles` and `PATCH /api/backup/profiles/<id>` take. */
export interface BackupProfileInput extends BackupOptions {
  name: string;
  source: BackupEndpoint;
  destination: BackupEndpoint;
  mode: BackupMode;
  memory?: BackupMemory;
  autoRunOnConnect: boolean;
  autoResume: boolean;
}

export type BackupWarningKind = "too-large" | "renamed" | "case-collision" | "type-conflict" | "special-file";

/** Something the plan noticed about a file: skipped, renamed for the destination, or in the way. */
export interface BackupWarning {
  kind: BackupWarningKind;
  /** Path inside the source. */
  path: string;
  message: string;
  /** For "renamed": the name it gets on the destination. */
  targetPath?: string;
}

/** A dry run (`POST /api/backup/preview`): what a run would do now. */
export interface BackupPreview {
  /** Where the files go, relative to the destination storage. */
  targetPath: string;
  fsType: string;
  copyFiles: number;
  copyBytes: number;
  skipFiles: number;
  deleteCount: number;
  /** The first destination paths a mirror would move to the trash. */
  deletePaths: string[];
  warnings: BackupWarning[];
  warningCount: number;
  requiredBytes: number;
  freeBytes: number;
  insufficientSpace: boolean;
}

export interface BackupRunError {
  path: string;
  message: string;
}

/** One backup run for History. */
export interface BackupRunSummary {
  id: string;
  jobId: string;
  profileId: string | null;
  name: string;
  mode: BackupMode;
  source: BackupEndpoint & { label: string };
  destination: BackupEndpoint & { label: string };
  memory?: BackupMemory;
  status: "running" | "paused" | "done" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  bytesCopied: number;
  filesCopied: number;
  filesSkipped: number;
  filesDeleted: number;
  errors: BackupRunError[];
  warnings: BackupWarning[];
  message: string | null;
}

/** `GET /api/backup/machine`: the computer in the middle of the topology, with its internal storages' capacity. */
export interface BackupMachine {
  hostname: string;
  mode: "desktop" | "server";
  storages: { storageId: string; label: string; size: number; used: number }[];
}

/** Why terminals can't be opened: not an admin, turned off in Settings › Security, or no terminal support on this machine. */
export type TerminalUnavailableCode = "ROLE" | "DISABLED" | "UNSUPPORTED";

/** A shell running in a folder (`GET /api/terminals`). It keeps running while its panel is minimized or the page reloads. */
export interface TerminalSummary {
  id: string;
  storageId: string;
  storageLabel: string;
  /** The folder it started in, relative to the storage. */
  path: string;
  /** The memory's name, the folder's name, or the storage's label. */
  title: string;
  /** The shell it runs: "zsh", "bash", "cmd.exe"… */
  shell: string;
  status: "running" | "exited";
  exitCode?: number;
  createdAt: string;
}

/** `GET /api/terminals`: whether this user may open terminals, and the ones they have open. */
export interface TerminalListResponse {
  available: boolean;
  unavailableCode?: TerminalUnavailableCode;
  unavailableReason?: string;
  terminals: TerminalSummary[];
}

/** A trashed text file and its content, for comparing with the file now in its place. */
export interface TrashedTextResponse {
  item: TrashItem;
  content: string;
}

/** What a zip download will hold, for the confirmation before it starts. */
export interface DownloadMeasurement {
  fileCount: number;
  totalBytes: number;
  /** Files stored encrypted: they are decrypted into the zip. */
  encryptedFileCount: number;
}

/** Whether LibreOffice (which previews pptx and older Office files) is installed on the CMM computer. */
export interface OfficeDetection {
  installed: boolean;
  version?: string;
  path?: string;
  checkedAt: string;
}
