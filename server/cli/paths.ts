import "server-only";
import path from "node:path";
import { SERVER_DEFAULT_CONFIG_FILE, SERVER_DEFAULT_DATA_DIR } from "@/server/config";

/**
 * Test-only: a folder that stands in for `/`. Every system path below is moved inside it, and the
 * CLI skips what needs root (systemctl, setfacl, chown, privilege checks). `install.sh` and
 * `uninstall.sh` honour the same variable, so the whole install can be rehearsed on a build machine.
 */
export const SANDBOX_ROOT_VARIABLE = "CMM_SANDBOX_ROOT";

export const SERVICE_NAME = "cmm";
export const SERVICE_ACCOUNT = "cmm";

/** Where an installed server keeps everything (overview §7). */
export interface SystemPaths {
  /** Set when running in a test sandbox; undefined on a real install. */
  sandboxRoot?: string;
  configFile: string;
  dataDir: string;
  tlsDirectory: string;
  certificateFile: string;
  keyFile: string;
  systemdDirectory: string;
  /** `cmm.service.d/storage.conf`, the drop-in with `ReadWritePaths=` for the storage roots. */
  storageDropInFile: string;
  /** `/opt/cmm`, holding one folder per version plus the `current` and `previous` links. */
  installRoot: string;
}

/**
 * The system paths for this run. `CMM_CONFIG` and `CMM_DATA_DIR` win, as for the server itself
 * (the unit sets both); otherwise the defaults, inside the sandbox root when there is one.
 */
export function resolveSystemPaths(environment: Record<string, string | undefined> = process.env): SystemPaths {
  const sandboxRoot = environment[SANDBOX_ROOT_VARIABLE] ? path.resolve(environment[SANDBOX_ROOT_VARIABLE]) : undefined;
  const inRoot = (systemPath: string) => (sandboxRoot ? path.join(sandboxRoot, systemPath) : systemPath);
  const tlsDirectory = inRoot("/etc/cmm/tls");
  const systemdDirectory = inRoot("/etc/systemd/system");
  return {
    ...(sandboxRoot ? { sandboxRoot } : {}),
    configFile: path.resolve(environment.CMM_CONFIG || inRoot(SERVER_DEFAULT_CONFIG_FILE)),
    dataDir: path.resolve(environment.CMM_DATA_DIR || inRoot(SERVER_DEFAULT_DATA_DIR)),
    tlsDirectory,
    certificateFile: path.join(tlsDirectory, "cert.pem"),
    keyFile: path.join(tlsDirectory, "key.pem"),
    systemdDirectory,
    storageDropInFile: path.join(systemdDirectory, `${SERVICE_NAME}.service.d`, "storage.conf"),
    installRoot: inRoot("/opt/cmm"),
  };
}
