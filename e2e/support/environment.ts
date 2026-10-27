import path from "node:path";

/*
 * Where the end-to-end run keeps everything: two throwaway CMM servers (one in server mode, the
 * "web" project; one in desktop mode, reached by a browser that fakes the desktop bridge, the
 * "desktop-mode" project), each with its own data folder and two storages. Nothing here touches
 * ~/.cmm, .cmm-dev-data or an installed CMM app.
 */

/*
 * `CMM_E2E_ROOT` moves it, for tests that need their storages outside this git checkout (CMM
 * refuses to start versioning inside another repository).
 */
export const E2E_ROOT = process.env.CMM_E2E_ROOT ?? path.join(process.cwd(), ".cmm-test-data");

export const ADMIN_USERNAME = "e2e-admin";
export const ADMIN_PASSWORD = "e2e-password-12345";
export const LAUNCH_TOKEN = "e2e-launch-token-for-desktop-mode-0123456789";

export interface ServerFlavor {
  name: "web" | "desktop";
  mode: "server" | "desktop";
  port: number;
  baseUrl: string;
  root: string;
  dataDirectory: string;
  /**
   * The first storage: most tests work in a folder of their own here. On a server it is the
   * "Smoke" storage; the desktop mode has one storage, "Home", which is the server's HOME, so that
   * folder is a scratch one.
   */
  firstStorage: string;
  firstStorageLabel: string;
  /** The second storage ("Second", server mode only): a move to it is a background job. */
  secondStorage: string;
  authFile: string;
}

function describeFlavor(name: ServerFlavor["name"], mode: ServerFlavor["mode"], port: number): ServerFlavor {
  const root = path.join(E2E_ROOT, name);
  return {
    name,
    mode,
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    root,
    dataDirectory: path.join(root, "data"),
    firstStorage: path.join(root, mode === "desktop" ? "home" : "storage-smoke"),
    firstStorageLabel: mode === "desktop" ? "Home" : FIRST_STORAGE_LABEL,
    secondStorage: path.join(root, "storage-second"),
    authFile: path.join(root, "auth.json"),
  };
}

export const FIRST_STORAGE_LABEL = "Smoke";
export const SECOND_STORAGE_LABEL = "Second";

export const WEB = describeFlavor("web", "server", 7432);
export const DESKTOP = describeFlavor("desktop", "desktop", 7433);
