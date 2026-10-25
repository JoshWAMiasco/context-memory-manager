/*
 * The CMM server as an Electron utility process: forked from the bundled
 * `app-server/entry.js`, its output piped to `server.log`, stopped with a `shutdown` message
 * (jobs pause with a checkpoint) and killed if it is still running 10 seconds later.
 */
import { utilityProcess, type UtilityProcess } from "electron";
import { formatLogLine, type RotatingLogFile } from "./log-file";

export const SHUTDOWN_TIMEOUT_MILLISECONDS = 10_000;

export interface DesktopServerOptions {
  entryPath: string;
  environment: Record<string, string>;
  serverLog: RotatingLogFile;
  /** Called when the server exits without being asked to (a crash). */
  onUnexpectedExit: (exitCode: number) => void;
}

/** One run of the CMM server. Create a new one to restart it. */
export class DesktopServer {
  private readonly options: DesktopServerOptions;
  private child: UtilityProcess | undefined;
  private isStopping = false;
  private readonly exited: Promise<number>;
  private resolveExited: (exitCode: number) => void = () => undefined;
  readonly exitController = new AbortController();

  /**
   * @example
   * const server = new DesktopServer({ entryPath, environment, serverLog, onUnexpectedExit });
   * server.start();
   */
  constructor(options: DesktopServerOptions) {
    this.options = options;
    this.exited = new Promise((resolve) => {
      this.resolveExited = resolve;
    });
  }

  /** Forks the server. Its stdout and stderr go to `server.log`. */
  start(): void {
    const { entryPath, environment, serverLog } = this.options;
    const child = utilityProcess.fork(entryPath, [], {
      serviceName: "CMM Server",
      stdio: "pipe",
      env: environment,
    });
    this.child = child;
    child.once("spawn", () => serverLog.write(formatLogLine("main", `server started with pid ${child.pid}`)));
    child.stdout?.on("data", (chunk: Buffer) => serverLog.write(formatLogLine("server", String(chunk))));
    child.stderr?.on("data", (chunk: Buffer) => serverLog.write(formatLogLine("server:err", String(chunk))));
    child.once("exit", (exitCode) => {
      serverLog.write(formatLogLine("main", `server exited with code ${exitCode}`));
      this.child = undefined;
      this.exitController.abort();
      this.resolveExited(exitCode);
      if (!this.isStopping) this.options.onUnexpectedExit(exitCode);
    });
  }

  /** True while the process is running. */
  get isRunning(): boolean {
    return this.child !== undefined;
  }

  /**
   * Asks the server to shut down (it checkpoints running jobs and exits) and waits for it; kills
   * it after `timeoutMilliseconds`.
   */
  async stop(timeoutMilliseconds = SHUTDOWN_TIMEOUT_MILLISECONDS): Promise<void> {
    this.isStopping = true;
    const child = this.child;
    if (!child) return;
    child.postMessage({ type: "shutdown" });
    const timer = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), timeoutMilliseconds));
    if ((await Promise.race([this.exited, timer])) === "timeout") {
      this.options.serverLog.write(formatLogLine("main", "server did not stop in time, killing it"));
      child.kill();
      await this.exited;
    }
  }
}
