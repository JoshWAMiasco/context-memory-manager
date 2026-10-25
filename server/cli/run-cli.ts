/* Parses a `ccm` command line and runs the command. The process entry is `server/cli/index.ts`. */
import "server-only";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { CliError } from "@/server/cli/cli-error";
import {
  CLI_VERSION,
  runAddStorage,
  runGenerateCertificate,
  runRemoveStorage,
  runResetAdmin,
  runRollback,
  runSetupCode,
  runStatus,
  runWriteDropIn,
} from "@/server/cli/commands";
import { runSystemCommand, type CliContext } from "@/server/cli/context";
import { resolveSystemPaths, SERVICE_NAME } from "@/server/cli/paths";

export const USAGE = `CCM ${CLI_VERSION} server admin

Usage: ccm <command> [options]

  status                         Service state, health, version, URLs and storage count
  reset-admin [username]         Give an admin a temporary password (lists the admins without a name)
  add-storage <path> [--label X] Let CCM use a folder: ACLs, config and the systemd drop-in
  remove-storage <path>          Stop using a folder (its files are never touched)
  gen-cert [--host name] [--days 825]
                                 Create a self-signed certificate and turn HTTPS on
  setup-code [--regenerate]      Print the first-run setup code
  logs                           Follow the service log (journalctl -u ccm -f)
  version                        Print the version
  rollback                       Switch back to the previously installed version

Commands that restart CCM accept --no-restart.`;

function readPositional(positionals: readonly string[], index: number, usageLine: string): string {
  const value = positionals[index];
  if (!value) throw new CliError(`Usage: ${usageLine}`, 2);
  return value;
}

function readWholeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsedNumber = Number(value);
  if (!Number.isInteger(parsedNumber)) throw new CliError(`${flag} must be a whole number.`, 2);
  return parsedNumber;
}

function followLogs(extraArguments: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const journal = spawn("journalctl", ["-u", SERVICE_NAME, "-f", ...extraArguments], { stdio: "inherit" });
    journal.on("error", () => {
      console.error("journalctl is not available on this system.");
      resolve(1);
    });
    journal.on("exit", (exitCode) => resolve(exitCode ?? 0));
  });
}

/** Runs one CLI invocation and resolves its exit code. */
export async function runCli(argumentList: readonly string[], context: CliContext): Promise<number> {
  const [commandName, ...commandArguments] = argumentList;
  if (commandName === "logs") return followLogs(commandArguments);
  const { values, positionals } = parseArgs({
    args: [...commandArguments],
    allowPositionals: true,
    options: {
      label: { type: "string" },
      host: { type: "string" },
      days: { type: "string" },
      wait: { type: "string" },
      regenerate: { type: "boolean" },
      plain: { type: "boolean" },
      "no-restart": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const shouldRestart = !values["no-restart"];
  switch (commandName) {
    case undefined:
    case "help":
    case "--help":
    case "-h": {
      context.print(USAGE);
      return 0;
    }
    case "version":
    case "--version": {
      context.print(CLI_VERSION);
      return 0;
    }
    case "status": {
      const waitSeconds = readWholeNumber(values.wait, "--wait");
      return (await runStatus(context, waitSeconds === undefined ? {} : { waitSeconds })) ? 0 : 1;
    }
    case "reset-admin": {
      await runResetAdmin(context, positionals[0]);
      return 0;
    }
    case "add-storage": {
      const rootInput = readPositional(positionals, 0, "ccm add-storage <path> [--label X]");
      await runAddStorage(context, rootInput, { ...(values.label ? { label: values.label } : {}), shouldRestart });
      return 0;
    }
    case "remove-storage": {
      await runRemoveStorage(context, readPositional(positionals, 0, "ccm remove-storage <path>"), { shouldRestart });
      return 0;
    }
    case "write-dropin": {
      await runWriteDropIn(context, shouldRestart);
      return 0;
    }
    case "gen-cert": {
      const days = readWholeNumber(values.days, "--days");
      await runGenerateCertificate(context, {
        ...(values.host ? { hostName: values.host } : {}),
        ...(days === undefined ? {} : { days }),
        shouldRestart,
      });
      return 0;
    }
    case "setup-code": {
      runSetupCode(context, { shouldRegenerate: Boolean(values.regenerate), isPlain: Boolean(values.plain) });
      return 0;
    }
    case "rollback": {
      await runRollback(context, shouldRestart);
      return 0;
    }
    default: {
      throw new CliError(`Unknown command "${commandName}".\n\n${USAGE}`, 2);
    }
  }
}

/** The context of a real run: this process's user, the system paths and the console. */
export function createProcessContext(): CliContext {
  return {
    paths: resolveSystemPaths(process.env),
    userId: process.getuid?.(),
    runCommand: runSystemCommand,
    print: (line) => console.log(line),
    warn: (line) => console.error(line),
  };
}
