import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";

export const APPLICATION_MODES = ["desktop", "server"] as const;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];

export const SERVER_DEFAULT_PORT = 7420;
export const SERVER_DEFAULT_CONFIG_FILE = "/etc/cmm/config.json";
export const SERVER_DEFAULT_DATA_DIR = "/var/lib/cmm";
/** Where a server installed as CCM kept them; used while the new paths don't exist yet. */
export const LEGACY_SERVER_CONFIG_FILE = "/etc/ccm/config.json";
export const LEGACY_SERVER_DATA_DIR = "/var/lib/ccm";
/** The default data folder outside server mode used to be `~/.ccm`. */
const LEGACY_DATA_DIR_NAME = ".ccm";

const storageRootSchema = z.object({
  path: z.string().min(1),
  label: z.string().min(1),
});

export const configSchema = z
  .object({
    mode: z.enum(APPLICATION_MODES),
    dataDir: z.string().min(1),
    bindHost: z.string().min(1),
    port: z.number().int().min(0).max(65_535),
    /* `null` (as in deploy/linux/config.example.json) and a missing key both mean plain HTTP. */
    tls: z
      .object({ certFile: z.string().min(1), keyFile: z.string().min(1) })
      .strict()
      .nullish(),
    trustedProxies: z.array(z.string().min(1)),
    storageRoots: z.array(storageRootSchema),
    autoLockMinutes: z.number().int().min(1).max(1440),
    unlockTtlMinutes: z.number().int().min(1).max(1440),
  })
  .strict();

type ParsedConfig = z.infer<typeof configSchema>;
export type TlsConfig = NonNullable<ParsedConfig["tls"]>;
export type CmmConfig = Omit<ParsedConfig, "tls"> & { tls?: TlsConfig };

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface ConfigSources {
  environment?: Record<string, string | undefined>;
  readTextFile?: (filePath: string) => string | undefined;
  pathExists?: (filePath: string) => boolean;
}

function readTextFileIfPresent(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch (readError) {
    if ((readError as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw readError;
  }
}

/** `/etc/cmm/config.json`, or the CCM-era `/etc/ccm/config.json` while only that exists. */
function resolveServerConfigFile(readTextFile: (filePath: string) => string | undefined): string {
  return readTextFile(SERVER_DEFAULT_CONFIG_FILE) === undefined && readTextFile(LEGACY_SERVER_CONFIG_FILE) !== undefined
    ? LEGACY_SERVER_CONFIG_FILE
    : SERVER_DEFAULT_CONFIG_FILE;
}

/** The default data folder, or the CCM-era one while only that exists (so an upgrade keeps its data). */
function resolveDefaultDataDirectory(mode: ApplicationMode, pathExists: (filePath: string) => boolean): string {
  const defaultDataDirectory = createDefaults(mode).dataDir;
  const legacyDataDirectory = mode === "server" ? LEGACY_SERVER_DATA_DIR : path.join(homedir(), LEGACY_DATA_DIR_NAME);
  return !pathExists(defaultDataDirectory) && pathExists(legacyDataDirectory)
    ? legacyDataDirectory
    : defaultDataDirectory;
}

function createDefaults(mode: ApplicationMode): CmmConfig {
  const isServer = mode === "server";
  return {
    mode,
    dataDir: isServer ? SERVER_DEFAULT_DATA_DIR : path.join(homedir(), ".cmm"),
    bindHost: isServer ? "0.0.0.0" : "127.0.0.1",
    port: isServer ? SERVER_DEFAULT_PORT : 0,
    trustedProxies: [],
    storageRoots: [],
    autoLockMinutes: 15,
    unlockTtlMinutes: 60,
  };
}

function parseMode(modeText: string | undefined): ApplicationMode | undefined {
  if (modeText === undefined || modeText === "") return undefined;
  if ((APPLICATION_MODES as readonly string[]).includes(modeText)) return modeText as ApplicationMode;
  throw new ConfigError(`CMM_MODE must be "desktop" or "server", received "${modeText}".`);
}

function parsePort(portText: string | undefined): number | undefined {
  if (portText === undefined || portText === "") return undefined;
  const port = Number(portText);
  if (!Number.isInteger(port)) throw new ConfigError(`PORT must be a whole number, received "${portText}".`);
  return port;
}

function readConfigFile(
  configFilePath: string,
  readTextFile: (filePath: string) => string | undefined,
): Record<string, unknown> {
  const fileText = readTextFile(configFilePath);
  if (fileText === undefined) return {};
  try {
    const parsedFile: unknown = JSON.parse(fileText);
    if (typeof parsedFile !== "object" || parsedFile === null || Array.isArray(parsedFile)) {
      throw new ConfigError(`The config file ${configFilePath} must contain a JSON object.`);
    }
    return parsedFile as Record<string, unknown>;
  } catch (parseError) {
    if (parseError instanceof ConfigError) throw parseError;
    throw new ConfigError(`The config file ${configFilePath} is not valid JSON: ${(parseError as Error).message}`);
  }
}

/**
 * Builds the config from, in order of precedence: environment variables (`CMM_MODE`,
 * `CMM_DATA_DIR`, `CMM_CONFIG`, `PORT`, `HOSTNAME`), the JSON config file, then the defaults for
 * the mode. A missing config file is fine; an invalid one throws a `ConfigError` that names every
 * problem.
 */
export function loadConfig({
  environment = process.env,
  readTextFile = readTextFileIfPresent,
  pathExists = existsSync,
}: ConfigSources = {}): CmmConfig {
  const environmentMode = parseMode(environment.CMM_MODE);
  const isServerMode = (environmentMode ?? "desktop") === "server";
  const configFilePath =
    environment.CMM_CONFIG ||
    (isServerMode
      ? resolveServerConfigFile(readTextFile)
      : path.join(environment.CMM_DATA_DIR || resolveDefaultDataDirectory("desktop", pathExists), "config.json"));
  const fileValues = readConfigFile(configFilePath, readTextFile);
  const fileMode = typeof fileValues.mode === "string" ? parseMode(fileValues.mode) : undefined;
  const mode = environmentMode ?? fileMode ?? "desktop";

  const environmentValues: Partial<CmmConfig> = { mode };
  if (environment.CMM_DATA_DIR) environmentValues.dataDir = environment.CMM_DATA_DIR;
  if (environment.HOSTNAME) environmentValues.bindHost = environment.HOSTNAME;
  const environmentPort = parsePort(environment.PORT);
  if (environmentPort !== undefined) environmentValues.port = environmentPort;

  const defaults = { ...createDefaults(mode), dataDir: resolveDefaultDataDirectory(mode, pathExists) };
  const parsedConfig = configSchema.safeParse({ ...defaults, ...fileValues, ...environmentValues });
  if (!parsedConfig.success) {
    throw new ConfigError(
      `Invalid CMM config (from ${configFilePath} and the environment):\n${z.prettifyError(parsedConfig.error)}`,
    );
  }
  const { tls, ...configValues } = parsedConfig.data;
  return { ...configValues, ...(tls ? { tls } : {}), dataDir: path.resolve(configValues.dataDir) };
}

/** The config of this process, loaded once from `process.env` and the config file. */
export function getConfig(): CmmConfig {
  return getGlobalSingleton("config", () => loadConfig());
}
