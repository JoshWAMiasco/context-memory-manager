import "server-only";

/** A problem the CLI reports as one readable line (no stack trace), exiting with `exitCode`. */
export class CliError extends Error {
  override name = "CliError";

  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}
