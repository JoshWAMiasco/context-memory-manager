import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DESKTOP, LAUNCH_TOKEN, SECOND_STORAGE_LABEL, WEB, type ServerFlavor } from "./environment";

/*
 * Starts the built web server (`dist/app/entry.js`, what `npm start` runs) on a fresh data folder
 * with two storages: `tsx e2e/support/start-server.ts web|desktop`. Playwright's `webServer` runs
 * it and stops it again; it exits with the server.
 */

const flavor: ServerFlavor = process.argv[2] === "desktop" ? DESKTOP : WEB;

rmSync(flavor.root, { recursive: true, force: true });
for (const folder of [flavor.dataDirectory, flavor.firstStorage, flavor.secondStorage]) {
  mkdirSync(folder, { recursive: true });
}
const configFile = path.join(flavor.dataDirectory, "config.json");
/* A server lists its storages in the config file; the desktop mode has just "Home" (see below). */
writeFileSync(
  configFile,
  JSON.stringify({
    storageRoots:
      flavor.mode === "server"
        ? [
            { path: flavor.firstStorage, label: flavor.firstStorageLabel },
            { path: flavor.secondStorage, label: SECOND_STORAGE_LABEL },
          ]
        : [],
  }),
);

const server = spawn(process.execPath, [path.join("dist", "app", "entry.js")], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    CMM_MODE: flavor.mode,
    CMM_DATA_DIR: flavor.dataDirectory,
    CMM_CONFIG: configFile,
    PORT: String(flavor.port),
    HOSTNAME: "127.0.0.1",
    /* The desktop mode's "Home" storage is the home folder: point it at a scratch one, never the real one. */
    ...(flavor.mode === "desktop" ? { CMM_LAUNCH_TOKEN: LAUNCH_TOKEN, HOME: flavor.firstStorage } : {}),
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
