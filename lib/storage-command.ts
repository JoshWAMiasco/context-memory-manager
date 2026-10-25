/** Quotes `value` for a POSIX shell when it holds anything beyond plain path characters. */
function quoteForShell(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The root command that lets the Linux service (user cmm) use a folder: ACLs, config and the
 * systemd drop-in. The web UI can't do this itself because CMM runs without root rights.
 *
 * @example
 * buildAddStorageCommand("/home/alex/notes", "Alex's notes");
 * // sudo cmm add-storage /home/alex/notes --label 'Alex'\''s notes'
 */
export function buildAddStorageCommand(rootPath: string, label: string): string {
  const trimmedLabel = label.trim();
  return `sudo cmm add-storage ${quoteForShell(rootPath)}${trimmedLabel ? ` --label ${quoteForShell(trimmedLabel)}` : ""}`;
}
