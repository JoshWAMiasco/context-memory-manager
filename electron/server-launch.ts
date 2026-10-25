/*
 * What the main process needs to start the CCM server, without Electron: a free loopback
 * port, the launch token, the server's environment and the health poll. Unit tested on their own;
 * `server-process.ts` does the forking.
 */
import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";

export const HEALTH_POLL_INTERVAL_MILLISECONDS = 150;
export const HEALTH_TIMEOUT_MILLISECONDS = 30_000;

/** macOS starts apps from Finder with a bare PATH; git from Homebrew or the installer lives here. */
const MACOS_EXTRA_PATHS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/local/git/bin"];

/** Variables of the main process that must not reach the server. */
const STRIPPED_VARIABLES = ["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS", "CCM_CONFIG", "CCM_APP_DIR"];

export interface ServerEnvironmentOptions {
  port: number;
  launchToken: string;
  dataDirectory: string;
}

/**
 * Picks a free port by listening on `127.0.0.1:0`, reading the port the OS chose and closing.
 *
 * @example
 * const port = await findFreePort(); // 53817
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probeServer = net.createServer();
    probeServer.once("error", reject);
    probeServer.listen(0, "127.0.0.1", () => {
      const { port } = probeServer.address() as net.AddressInfo;
      probeServer.close(() => resolve(port));
    });
  });
}

/**
 * A fresh launch token: 32 random bytes, base64url (cookie-safe).
 *
 * @example
 * const launchToken = createLaunchToken(); // "q2h…" (43 characters)
 */
export function createLaunchToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The server's environment: the main process's own (so PATH finds git), minus Electron and
 * config overrides, plus desktop mode, the data folder, the port, loopback only, the launch token,
 * production and no telemetry. On macOS the usual git folders are added to PATH.
 *
 * @example
 * buildServerEnvironment({ port: 5123, launchToken, dataDirectory: app.getPath("userData") }, process.env, "darwin");
 */
export function buildServerEnvironment(
  { port, launchToken, dataDirectory }: ServerEnvironmentOptions,
  baseEnvironment: Record<string, string | undefined>,
  platform: string,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnvironment)) {
    if (value !== undefined && !STRIPPED_VARIABLES.includes(name)) environment[name] = value;
  }
  if (platform === "darwin") {
    const pathEntries = (environment.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin").split(path.delimiter).filter(Boolean);
    for (const extraPath of MACOS_EXTRA_PATHS) if (!pathEntries.includes(extraPath)) pathEntries.push(extraPath);
    environment.PATH = pathEntries.join(path.delimiter);
  }
  return {
    ...environment,
    CCM_MODE: "desktop",
    CCM_DATA_DIR: dataDirectory,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    CCM_LAUNCH_TOKEN: launchToken,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
  };
}

export interface HealthPollOptions {
  timeoutMilliseconds?: number;
  intervalMilliseconds?: number;
  /** Stops polling early, for example when the server process exits. */
  signal?: AbortSignal;
  fetchFunction?: typeof fetch;
}

/**
 * Polls `/api/health` (with the launch cookie) every 150 ms until it answers 200; rejects after
 * 30 seconds or when `signal` aborts.
 *
 * @example
 * await waitForHealth("http://127.0.0.1:5123", launchToken);
 */
export async function waitForHealth(
  origin: string,
  launchToken: string,
  {
    timeoutMilliseconds = HEALTH_TIMEOUT_MILLISECONDS,
    intervalMilliseconds = HEALTH_POLL_INTERVAL_MILLISECONDS,
    signal,
    fetchFunction = fetch,
  }: HealthPollOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error("The CCM server stopped while starting.");
    try {
      const response = await fetchFunction(`${origin}/api/health`, {
        headers: { cookie: `ccm_launch=${launchToken}` },
        signal: AbortSignal.timeout(Math.max(intervalMilliseconds, 2000)),
      });
      if (response.ok) return;
    } catch {
      /* Not listening yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMilliseconds));
  }
  throw new Error(`CCM did not start within ${Math.round(timeoutMilliseconds / 1000)} seconds.`);
}
