/*
 * The SQLite schema. This is the one `server/` file without `import "server-only"`: drizzle-kit
 * loads it in plain Node to generate migrations. It only declares tables.
 */
import { sql } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAtColumn = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "editor", "viewer"] }).notNull(),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
  /** Light, Dark or System (follow the computer); each user's own. */
  theme: text("theme", { enum: ["dark", "light", "system"] }).notNull().default("dark"),
  createdAt: createdAtColumn(),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
});

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAtColumn(),
  lastActivityAt: integer("last_activity_at", { mode: "timestamp_ms" }).notNull(),
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  ip: text("ip"),
  userAgent: text("user_agent"),
  networkClass: text("network_class", { enum: ["desktop", "loopback", "lan", "remote"] }).notNull(),
  lanConfirmedAt: integer("lan_confirmed_at", { mode: "timestamp_ms" }),
});

export const stepUpTokens = sqliteTable("step_up_tokens", {
  idHash: text("id_hash").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.idHash, { onDelete: "cascade" }),
  action: text("action").notNull(),
  resource: text("resource").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  usedAt: integer("used_at", { mode: "timestamp_ms" }),
});

export const storages = sqliteTable("storages", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["internal", "external", "usb"] }).notNull(),
  label: text("label").notNull(),
  rootPath: text("root_path").notNull(),
  volumeUuid: text("volume_uuid"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAtColumn(),
});

export const storageAccess = sqliteTable(
  "storage_access",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storageId: text("storage_id")
      .notNull()
      .references(() => storages.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["read", "write"] }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.storageId] })],
);

/**
 * Where protection is set: an index of the `.cmm/protection.json` settings CMM made, so the
 * tamper watcher and the "contains a protected folder" check don't have to scan storages. The
 * `.cmm/` files stay the source of truth.
 */
export const protectedScopes = sqliteTable(
  "protected_scopes",
  {
    storageId: text("storage_id")
      .notNull()
      .references(() => storages.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    kind: text("kind", { enum: ["folder", "file"] }).notNull(),
    mode: text("mode", { enum: ["view-only", "locked"] }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.storageId, table.path] })],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status", { enum: ["queued", "running", "paused", "done", "failed", "cancelled"] }).notNull(),
  scopeJson: text("scope_json"),
  payloadJson: text("payload_json"),
  progressJson: text("progress_json"),
  checkpointJson: text("checkpoint_json"),
  error: text("error"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAtColumn(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const encryptedScopes = sqliteTable(
  "encrypted_scopes",
  {
    storageId: text("storage_id")
      .notNull()
      .references(() => storages.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    folderId: text("folder_id").notNull(),
    keyId: text("key_id").notNull(),
    state: text("state", { enum: ["encrypting", "encrypted", "decrypting", "rekeying"] }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.storageId, table.path] })],
);

/**
 * Versioned folders, so the external-change watcher knows what to watch. Each folder's
 * `.cmm/versioning.json` stays the source of truth.
 */
export const versionedScopes = sqliteTable(
  "versioned_scopes",
  {
    storageId: text("storage_id")
      .notNull()
      .references(() => storages.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.storageId, table.path] })],
);

/**
 * Saved backups: a source folder (or, for a memory backup, several folders gathered into a new
 * memory folder), a destination folder and a mode. Storages are named by
 * storage id; a drive's id is made from its volume id (`ext-<volume id>`), so a profile still
 * finds the drive after it is unplugged, plugged into another port or given another drive letter.
 */
export const backupProfiles = sqliteTable("backup_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceStorageId: text("source_storage_id").notNull(),
  sourcePath: text("source_path").notNull(),
  destinationStorageId: text("destination_storage_id").notNull(),
  destinationPath: text("destination_path").notNull(),
  mode: text("mode", { enum: ["copy", "mirror", "snapshot"] }).notNull(),
  /** A memory backup: the memory's name and its folders (a JSON array of paths in the source storage). */
  memoryName: text("memory_name"),
  memoryPathsJson: text("memory_paths_json"),
  compare: text("compare", { enum: ["size-mtime", "checksum"] })
    .notNull()
    .default("size-mtime"),
  verify: integer("verify", { mode: "boolean" }).notNull().default(false),
  includeGit: integer("include_git", { mode: "boolean" }).notNull().default(true),
  excludesJson: text("excludes_json").notNull().default("[]"),
  autoRunOnConnect: integer("auto_run_on_connect", { mode: "boolean" }).notNull().default(false),
  autoResume: integer("auto_resume", { mode: "boolean" }).notNull().default(true),
  keepSnapshots: integer("keep_snapshots"),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAtColumn(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

/** One backup run: a profile's run or an ad-hoc one, written when its job starts and ends. */
export const backupRuns = sqliteTable("backup_runs", {
  id: text("id").primaryKey(),
  /** The queue job that ran it (one run per job, also across pauses). */
  jobId: text("job_id").notNull().unique(),
  profileId: text("profile_id").references(() => backupProfiles.id, { onDelete: "set null" }),
  /** The profile's name then, or "Ad-hoc backup". */
  name: text("name").notNull(),
  mode: text("mode", { enum: ["copy", "mirror", "snapshot"] }).notNull(),
  sourceJson: text("source_json").notNull(),
  destinationJson: text("destination_json").notNull(),
  status: text("status", { enum: ["running", "paused", "done", "failed", "cancelled"] }).notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  bytesCopied: integer("bytes_copied").notNull().default(0),
  filesCopied: integer("files_copied").notNull().default(0),
  filesSkipped: integer("files_skipped").notNull().default(0),
  filesDeleted: integer("files_deleted").notNull().default(0),
  errorsJson: text("errors_json").notNull().default("[]"),
  warningsJson: text("warnings_json").notNull().default("[]"),
  message: text("message"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
});

/**
 * Memory folders the dashboard's search has found, so they show at once the next time CMM starts:
 * walking a big home folder takes a while, and macOS can hold it up while it asks for permission.
 * Each is checked again before it is shown.
 */
export const memoryLocations = sqliteTable(
  "memory_locations",
  {
    storageId: text("storage_id")
      .notNull()
      .references(() => storages.id, { onDelete: "cascade" }),
    /** The memory folder, relative to the storage root. */
    path: text("path").notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.storageId, table.path] })],
);
