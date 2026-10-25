import "server-only";
import { chmodSync, chownSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ConfigError, loadConfig, type CcmConfig } from "@/server/config";
import { CliError } from "@/server/cli/cli-error";
import type { SystemPaths } from "@/server/cli/paths";

/** The config file as written on disk: only the keys someone set, kept as they are. */
export type ConfigDocument = Record<string, unknown>;

export interface StorageRootEntry {
  path: string;
  label: string;
}

/** Reads `/etc/ccm/config.json`; a missing file is an empty document. */
export function readConfigDocument(configFile: string): ConfigDocument {
  if (!existsSync(configFile)) return {};
  let parsedDocument: unknown;
  try {
    parsedDocument = JSON.parse(readFileSync(configFile, "utf8"));
  } catch (parseError) {
    throw new CliError(`${configFile} is not valid JSON: ${(parseError as Error).message}`);
  }
  if (typeof parsedDocument !== "object" || parsedDocument === null || Array.isArray(parsedDocument)) {
    throw new CliError(`${configFile} must contain a JSON object.`);
  }
  return parsedDocument as ConfigDocument;
}

/** The effective server config that `document` gives, exactly as the service will load it. Throws a `CliError` when invalid. */
export function resolveServerConfig(document: ConfigDocument, paths: SystemPaths): CcmConfig {
  try {
    return loadConfig({
      environment: { CCM_MODE: "server", CCM_CONFIG: paths.configFile, CCM_DATA_DIR: paths.dataDir },
      readTextFile: () => JSON.stringify(document),
    });
  } catch (configError) {
    if (configError instanceof ConfigError) throw new CliError(configError.message);
    throw configError;
  }
}

/**
 * Validates `document`, then replaces the config file atomically (temporary file and rename). The
 * new file keeps the old one's mode and owner (0640 root:ccm after `install.sh`).
 */
export function writeConfigDocument(paths: SystemPaths, document: ConfigDocument): void {
  resolveServerConfig(document, paths);
  const configFile = paths.configFile;
  const previousStats = existsSync(configFile) ? statSync(configFile) : undefined;
  const temporaryFile = path.join(path.dirname(configFile), `.${path.basename(configFile)}.${process.pid}.tmp`);
  writeFileSync(temporaryFile, `${JSON.stringify(document, undefined, 2)}\n`, { mode: 0o640 });
  chmodSync(temporaryFile, previousStats ? previousStats.mode & 0o777 : 0o640);
  if (previousStats && process.getuid?.() === 0) chownSync(temporaryFile, previousStats.uid, previousStats.gid);
  renameSync(temporaryFile, configFile);
}

export function readStorageRoots(document: ConfigDocument): StorageRootEntry[] {
  const storageRoots = document.storageRoots;
  if (!Array.isArray(storageRoots)) return [];
  return storageRoots.filter(
    (storageRoot): storageRoot is StorageRootEntry =>
      typeof storageRoot === "object" &&
      storageRoot !== null &&
      typeof (storageRoot as StorageRootEntry).path === "string" &&
      typeof (storageRoot as StorageRootEntry).label === "string",
  );
}

/** `document` with `rootPath` in `storageRoots` (once), and whether it was new. */
export function withStorageRoot(
  document: ConfigDocument,
  rootPath: string,
  label: string,
): { document: ConfigDocument; isNew: boolean } {
  const storageRoots = readStorageRoots(document);
  const isNew = !storageRoots.some((storageRoot) => path.resolve(storageRoot.path) === rootPath);
  return {
    document: { ...document, storageRoots: isNew ? [...storageRoots, { path: rootPath, label }] : storageRoots },
    isNew,
  };
}

/** `document` without `rootPath` in `storageRoots`, and whether it was there. */
export function withoutStorageRoot(
  document: ConfigDocument,
  rootPath: string,
): { document: ConfigDocument; wasPresent: boolean } {
  const storageRoots = readStorageRoots(document);
  const remainingRoots = storageRoots.filter((storageRoot) => path.resolve(storageRoot.path) !== rootPath);
  return {
    document: { ...document, storageRoots: remainingRoots },
    wasPresent: remainingRoots.length !== storageRoots.length,
  };
}

export function withTls(document: ConfigDocument, certFile: string, keyFile: string): ConfigDocument {
  return { ...document, tls: { certFile, keyFile } };
}
