import "server-only";
import type { ApplicationMode } from "@/server/config";

/**
 * Why the server must not start, or undefined when it may. In server mode CCM refuses to run as
 * root: the systemd unit runs it as the `ccm` user, and a root server would create files (the
 * database, trash, encrypted copies) that the service account can't open later. Desktop mode runs
 * as the person using the app, so it is not checked.
 */
export function findRootRefusal(
  mode: ApplicationMode,
  userId: number | undefined = process.getuid?.(),
): string | undefined {
  if (mode !== "server" || userId !== 0) return undefined;
  return "CCM does not run as root. Start it with `systemctl start ccm` (it runs as the ccm user), or as an ordinary user.";
}
