/*
 * The `ccm` admin CLI for server installs. Bundled by esbuild into `dist/cli/ccm.js`,
 * shipped as `app/cli.js` and started by `bin/ccm` with the bundled Node runtime.
 */
import "server-only";
import { CliError } from "@/server/cli/cli-error";
import { createProcessContext, runCli, USAGE } from "@/server/cli/run-cli";

runCli(process.argv.slice(2), createProcessContext())
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((cliError: unknown) => {
    if (cliError instanceof CliError) {
      console.error(`ccm: ${cliError.message}`);
      process.exitCode = cliError.exitCode;
      return;
    }
    if (cliError instanceof TypeError && (cliError as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS")) {
      console.error(`ccm: ${cliError.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    console.error("ccm: unexpected error", cliError);
    process.exitCode = 1;
  });
