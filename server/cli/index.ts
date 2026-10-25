/*
 * The `cmm` admin CLI for server installs. Bundled by esbuild into `dist/cli/cmm.js`,
 * shipped as `app/cli.js` and started by `bin/cmm` with the bundled Node runtime.
 */
import "server-only";
import { adoptLegacyEnvironment } from "@/lib/fs/legacy-names";
import { CliError } from "@/server/cli/cli-error";
import { createProcessContext, runCli, USAGE } from "@/server/cli/run-cli";

// Settings named CCM_… (before the rename to CMM) still apply.
adoptLegacyEnvironment(process.env);

runCli(process.argv.slice(2), createProcessContext())
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((cliError: unknown) => {
    if (cliError instanceof CliError) {
      console.error(`cmm: ${cliError.message}`);
      process.exitCode = cliError.exitCode;
      return;
    }
    if (cliError instanceof TypeError && (cliError as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`cmm: ${cliError.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    console.error("cmm: unexpected error", cliError);
    process.exitCode = 1;
  });
