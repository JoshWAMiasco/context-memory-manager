import "server-only";
import { X509Certificate } from "node:crypto";
import { chmodSync, chownSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces as readNetworkInterfaces, type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import packageManifest from "@/package.json";
import { hashPassword } from "@/server/auth/password";
import { generateSetupCode, SETUP_CODE_FILE_NAME } from "@/server/auth/setup-code";
import {
  collectSubjectAltNames,
  DEFAULT_CERTIFICATE_DAYS,
  generateSelfSignedCertificate,
  writeCertificateFiles,
} from "@/server/cli/certificate";
import { CliError } from "@/server/cli/cli-error";
import {
  readConfigDocument,
  readStorageRoots,
  resolveServerConfig,
  withoutStorageRoot,
  withStorageRoot,
  withTls,
  writeConfigDocument,
} from "@/server/cli/config-file";
import {
  readServiceOwner,
  requireRoot,
  requireRootOrServiceAccount,
  shouldChangeOwnership,
  type CliContext,
} from "@/server/cli/context";
import {
  countStorages,
  findTemporaryPasswordProblem,
  generateTemporaryPassword,
  hasAdmin,
  listAdmins,
  openExistingDatabase,
  registerInternalStorage,
  restoreDatabaseOwnership,
  setTemporaryAdminPassword,
  unregisterInternalStorage,
} from "@/server/cli/database";
import { checkHealth, listServiceUrls, type HealthCheck } from "@/server/cli/health";
import { readInstalledReleases, rollBackRelease } from "@/server/cli/releases";
import { grantServiceAccess, validateStorageRoot } from "@/server/cli/storage-access";
import { readServiceState, reloadAndRestart, writeStorageDropIn } from "@/server/cli/systemd";
import type { CmmDatabase } from "@/server/db/client";

export const CLI_VERSION = packageManifest.version;

/**
 * Runs `work` against the existing database and closes it again. As root, the database files are
 * handed back to the service account afterwards. Returns undefined before the first start.
 */
function withExistingDatabase<Result>(
  context: CliContext,
  work: (database: CmmDatabase) => Result,
): Result | undefined {
  const database = openExistingDatabase(context.paths.dataDir);
  if (!database) return undefined;
  try {
    return work(database);
  } finally {
    database.connection.close();
    const serviceOwner = readServiceOwner(context.paths);
    if (shouldChangeOwnership(context) && serviceOwner) restoreDatabaseOwnership(context.paths.dataDir, serviceOwner);
  }
}

function describeHealth(healthCheck: HealthCheck): string {
  if (!healthCheck.isHealthy) return `not reachable at ${healthCheck.url} (${healthCheck.problem})`;
  const { health } = healthCheck;
  return `ok (${health.mode} mode, version ${health.version}, SQLite ${health.sqlite}, argon2 ${health.argon2 ? "ok" : "failing"})`;
}

export interface StatusOptions {
  /** Poll the health check for up to this many seconds (install.sh waits for the first start). */
  waitSeconds?: number;
  networkInterfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

/** `cmm status`. Resolves true when the server answered its health check. */
export async function runStatus(context: CliContext, options: StatusOptions = {}): Promise<boolean> {
  const config = resolveServerConfig(readConfigDocument(context.paths.configFile), context.paths);
  const deadline = Date.now() + (options.waitSeconds ?? 0) * 1000;
  let healthCheck = await checkHealth(config);
  while (!healthCheck.isHealthy && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    healthCheck = await checkHealth(config);
  }
  const releases = readInstalledReleases(context.paths.installRoot);
  let storageSummary: string;
  let setupSummary: string;
  try {
    const databaseFacts = withExistingDatabase(context, ({ orm }) => ({
      storageCount: countStorages(orm),
      isSetUp: hasAdmin(orm),
    }));
    storageSummary = databaseFacts ? String(databaseFacts.storageCount) : "none yet (CMM has not started)";
    setupSummary = databaseFacts?.isSetUp ? "complete" : "waiting for the setup code (sudo cmm setup-code)";
  } catch {
    storageSummary = "unknown (run with sudo to read the database)";
    setupSummary = "unknown (run with sudo to read the database)";
  }
  const urls = listServiceUrls(config, options.networkInterfaces ?? readNetworkInterfaces());
  const lines: [string, string][] = [
    ["CMM", CLI_VERSION],
    [
      "Installed",
      releases.current
        ? `${releases.current}${releases.previous ? ` (previous: ${releases.previous})` : ""}`
        : "not under /opt/cmm",
    ],
    ["Service", await readServiceState(context)],
    ["Health", describeHealth(healthCheck)],
    ["Listening", `${config.tls ? "https" : "http"}://${config.bindHost}:${config.port}${config.tls ? " (TLS)" : ""}`],
    ["Open", urls.join("  ")],
    ["Storages", storageSummary],
    ["Setup", setupSummary],
  ];
  for (const [label, value] of lines) context.print(`${`${label}:`.padEnd(11)}${value}`);
  return healthCheck.isHealthy;
}

/** `cmm reset-admin [username]`: lists the admins, or gives one a temporary password. */
export async function runResetAdmin(context: CliContext, username?: string): Promise<void> {
  requireRootOrServiceAccount(context, `cmm reset-admin${username ? ` ${username}` : ""}`);
  if (!username) {
    const admins = withExistingDatabase(context, ({ orm }) => listAdmins(orm));
    if (!admins || admins.length === 0) {
      context.print("There are no admins yet. Finish setup in the browser with the setup code (sudo cmm setup-code).");
      return;
    }
    context.print("Admins:");
    for (const admin of admins) {
      const lastLogin = admin.lastLoginAt ? `last sign-in ${admin.lastLoginAt.toISOString()}` : "never signed in";
      context.print(`  ${admin.username}  (${lastLogin}${admin.disabled ? ", disabled" : ""})`);
    }
    context.print("Reset one with: sudo cmm reset-admin <username>");
    return;
  }
  const temporaryPassword = generateTemporaryPassword();
  const policyProblem = findTemporaryPasswordProblem(username, temporaryPassword);
  if (policyProblem) throw new CliError(`Could not make a valid temporary password: ${policyProblem}`);
  const passwordHash = await hashPassword(temporaryPassword);
  let resetAdmin;
  try {
    resetAdmin = withExistingDatabase(context, ({ orm }) => setTemporaryAdminPassword(orm, username, passwordHash));
  } catch (resetError) {
    throw new CliError((resetError as Error).message);
  }
  if (!resetAdmin) throw new CliError("CMM has no database yet: start it once and finish setup first.");
  context.print(`Temporary password for ${resetAdmin.username}: ${temporaryPassword}`);
  context.print("Sign in with it; CMM then asks for a new password. Their other sessions were signed out.");
  if (resetAdmin.disabled) context.warn("This account is disabled; another admin must enable it in Settings › Users.");
}

export interface StorageCommandOptions {
  label?: string;
  shouldRestart: boolean;
}

/** `cmm add-storage <path> [--label X]`. Running it again for a registered path re-applies access and the drop-in. */
export async function runAddStorage(
  context: CliContext,
  rootInput: string,
  options: StorageCommandOptions,
): Promise<void> {
  requireRoot(context, `cmm add-storage ${rootInput}`);
  const rootPath = validateStorageRoot(rootInput, context.paths);
  const label = options.label?.trim() || path.basename(rootPath);
  await grantServiceAccess(context, rootPath);
  const { document, isNew } = withStorageRoot(readConfigDocument(context.paths.configFile), rootPath, label);
  writeConfigDocument(context.paths, document);
  context.print(
    isNew
      ? `Added ${rootPath} to ${context.paths.configFile} as "${label}".`
      : `${rootPath} was already in ${context.paths.configFile}.`,
  );
  writeStorageDropIn(
    context,
    readStorageRoots(document).map((storageRoot) => storageRoot.path),
  );
  if (withExistingDatabase(context, ({ orm }) => registerInternalStorage(orm, rootPath, label))) {
    context.print(`Registered the storage "${label}".`);
  }
  await reloadAndRestart(context, options.shouldRestart);
}

/** `cmm remove-storage <path>`: unregisters the root and closes it in the drop-in. Never touches the files. */
export async function runRemoveStorage(
  context: CliContext,
  rootInput: string,
  options: StorageCommandOptions,
): Promise<void> {
  requireRoot(context, `cmm remove-storage ${rootInput}`);
  if (!path.isAbsolute(rootInput)) throw new CliError(`Give the absolute path of the storage (got "${rootInput}").`);
  const rootPath = existsSync(rootInput) ? realpathSync(rootInput) : path.resolve(rootInput);
  const { document, wasPresent } = withoutStorageRoot(readConfigDocument(context.paths.configFile), rootPath);
  if (wasPresent) {
    writeConfigDocument(context.paths, document);
    context.print(`Removed ${rootPath} from ${context.paths.configFile}.`);
  }
  writeStorageDropIn(
    context,
    readStorageRoots(document).map((storageRoot) => storageRoot.path),
  );
  const wasRegistered = withExistingDatabase(context, ({ orm }) => unregisterInternalStorage(orm, rootPath));
  if (wasRegistered) context.print(`Unregistered the storage at ${rootPath}. Its files were not touched.`);
  if (!wasPresent && !wasRegistered) context.warn(`${rootPath} was not a storage.`);
  context.print(`CMM's access to the files stays until you remove it: sudo setfacl -R -x u:cmm,d:u:cmm '${rootPath}'`);
  await reloadAndRestart(context, options.shouldRestart);
}

/** `cmm write-dropin`: rewrites the storage drop-in from the config (install.sh uses it after a reinstall). */
export async function runWriteDropIn(context: CliContext, shouldRestart: boolean): Promise<void> {
  requireRoot(context, "cmm write-dropin");
  const document = readConfigDocument(context.paths.configFile);
  writeStorageDropIn(
    context,
    readStorageRoots(document).map((storageRoot) => path.resolve(storageRoot.path)),
  );
  await reloadAndRestart(context, shouldRestart);
}

export interface CertificateCommandOptions {
  hostName?: string;
  days?: number;
  shouldRestart: boolean;
  networkInterfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}

/** `cmm gen-cert [--host name] [--days 825]`: a self-signed certificate, then TLS on. */
export async function runGenerateCertificate(context: CliContext, options: CertificateCommandOptions): Promise<void> {
  requireRoot(context, "cmm gen-cert");
  const days = options.days ?? DEFAULT_CERTIFICATE_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 3650)
    throw new CliError("--days must be a whole number from 1 to 3650.");
  const hostName = options.hostName?.trim() || hostname();
  const altNames = collectSubjectAltNames(hostName, options.networkInterfaces ?? readNetworkInterfaces());
  const certificatePair = await generateSelfSignedCertificate({ hostName, days, altNames });
  const serviceOwner = readServiceOwner(context.paths);
  writeCertificateFiles(
    {
      tlsDirectory: context.paths.tlsDirectory,
      certificateFile: context.paths.certificateFile,
      keyFile: context.paths.keyFile,
      ...(shouldChangeOwnership(context) && serviceOwner ? { serviceGroupId: serviceOwner.groupId } : {}),
    },
    certificatePair,
  );
  const document = withTls(
    readConfigDocument(context.paths.configFile),
    context.paths.certificateFile,
    context.paths.keyFile,
  );
  writeConfigDocument(context.paths, document);
  const certificate = new X509Certificate(certificatePair.certificatePem);
  context.print(
    `Wrote ${context.paths.certificateFile} and ${context.paths.keyFile}, valid until ${new Date(certificate.validTo).toISOString().slice(0, 10)}.`,
  );
  context.print(`Names: ${[...altNames.dnsNames, ...altNames.ipAddresses].join(", ")}`);
  context.print(`SHA-256 fingerprint: ${certificate.fingerprint256}`);
  context.print("Browsers warn about a self-signed certificate; compare the fingerprint above before you accept it.");
  await reloadAndRestart(context, options.shouldRestart);
}

export interface SetupCodeOptions {
  shouldRegenerate: boolean;
  /** Print only the code (for install.sh). */
  isPlain: boolean;
}

/** `cmm setup-code [--regenerate]`: prints the first-run setup code, creating it when missing. */
export function runSetupCode(context: CliContext, options: SetupCodeOptions): void {
  requireRootOrServiceAccount(context, "cmm setup-code");
  if (!existsSync(context.paths.dataDir))
    throw new CliError(`${context.paths.dataDir} does not exist. Is CMM installed?`);
  if (withExistingDatabase(context, ({ orm }) => hasAdmin(orm))) {
    if (!options.isPlain)
      context.print("Setup is complete, so there is no setup code. To recover an admin: sudo cmm reset-admin");
    return;
  }
  const setupCodeFile = path.join(context.paths.dataDir, SETUP_CODE_FILE_NAME);
  const existingCode = existsSync(setupCodeFile) ? readFileSync(setupCodeFile, "utf8").trim() : "";
  let setupCode = existingCode;
  if (options.shouldRegenerate || !existingCode) {
    setupCode = generateSetupCode();
    writeFileSync(setupCodeFile, `${setupCode}\n`, { mode: 0o600 });
    chmodSync(setupCodeFile, 0o600);
    const serviceOwner = readServiceOwner(context.paths);
    if (shouldChangeOwnership(context) && serviceOwner)
      chownSync(setupCodeFile, serviceOwner.userId, serviceOwner.groupId);
  }
  if (options.isPlain) {
    context.print(setupCode);
    return;
  }
  context.print(`Setup code: ${setupCode}`);
  context.print(
    `Enter it on the first page CMM shows in the browser. It is stored in ${setupCodeFile} until setup is done.`,
  );
}

/** `cmm rollback`: switches `/opt/cmm/current` to the previous version and restarts. */
export async function runRollback(context: CliContext, shouldRestart: boolean): Promise<void> {
  requireRoot(context, "cmm rollback");
  const { from, to } = rollBackRelease(context.paths.installRoot);
  context.print(`Switched CMM from ${from} to ${to}. Run \`sudo cmm rollback\` again to go back to ${from}.`);
  await reloadAndRestart(context, shouldRestart);
}
