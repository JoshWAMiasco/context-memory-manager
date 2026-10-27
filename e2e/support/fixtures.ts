import { randomUUID } from "node:crypto";
import { mkdirSync, truncateSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { listStorages } from "./api";
import { ADMIN_PASSWORD, DESKTOP, SECOND_STORAGE_LABEL, WEB } from "./environment";

export { expect };

/**
 * A folder of the test's own in both storages, made on disk before the test. Paths given to
 * `path`, `disk` and `url` are relative to it, so tests never see each other's files.
 */
export interface Workspace {
  name: string;
  firstStorageId: string;
  /** Empty in the desktop mode, which has one storage. */
  secondStorageId: string;
  /** The storage-relative path of something in the workspace ("ws-1a2b/docs/a.txt"). */
  path: (...segments: string[]) => string;
  /** Its absolute path on disk, in the first storage. */
  disk: (...segments: string[]) => string;
  /** Its absolute path on disk, in the second storage. */
  diskSecond: (...segments: string[]) => string;
  /** The explorer page of something in the workspace, in the first storage. */
  url: (...segments: string[]) => string;
  /** The explorer page of something in the workspace, in the second storage. */
  urlSecond: (...segments: string[]) => string;
  /** Writes a text file (and its folders) in the first storage. */
  writeText: (relativePath: string, content?: string) => string;
  /** Makes a folder in the first storage. */
  makeFolder: (relativePath: string) => string;
  /** Makes a sparse file of `megabytes`: instant to create, slow enough to copy to hold a job open. */
  makeBigFile: (relativePath: string, megabytes: number) => string;
}

export const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ request }, use, testInfo) => {
    const flavor = testInfo.project.name === "desktop-mode" ? DESKTOP : WEB;
    const storages = await listStorages(request);
    const first = storages.find((storage) => storage.label === flavor.firstStorageLabel);
    const second = storages.find((storage) => storage.label === SECOND_STORAGE_LABEL);
    if (!first || (flavor.mode === "server" && !second)) throw new Error("The test storages are missing.");
    const name = `ws-${randomUUID().slice(0, 8)}`;
    const makeFolder = (relativePath: string) => {
      const folder = path.join(flavor.firstStorage, name, relativePath);
      mkdirSync(folder, { recursive: true });
      return folder;
    };
    makeFolder("");
    mkdirSync(path.join(flavor.secondStorage, name), { recursive: true });
    const href = (storageId: string, segments: string[]) =>
      `/storage/${storageId}/${[name, ...segments].map((segment) => encodeURIComponent(segment)).join("/")}`;
    await use({
      name,
      firstStorageId: first.id,
      secondStorageId: second?.id ?? "",
      path: (...segments) => [name, ...segments].join("/"),
      disk: (...segments) => path.join(flavor.firstStorage, name, ...segments),
      diskSecond: (...segments) => path.join(flavor.secondStorage, name, ...segments),
      url: (...segments) => href(first.id, segments),
      urlSecond: (...segments) => href(second?.id ?? "", segments),
      writeText: (relativePath, content = `content of ${relativePath}\n`) => {
        makeFolder(path.dirname(relativePath));
        const file = path.join(flavor.firstStorage, name, relativePath);
        writeFileSync(file, content);
        return file;
      },
      makeFolder,
      makeBigFile: (relativePath, megabytes) => {
        makeFolder(path.dirname(relativePath));
        const file = path.join(flavor.firstStorage, name, relativePath);
        writeFileSync(file, "");
        truncateSync(file, megabytes * 1024 * 1024);
        return file;
      },
    });
  },
});

/**
 * Waits for the first-load overlay to fade out. Playwright's normal clicks wait for it; a forced
 * click (needed on busy, aria-disabled rows) does not, and would land on the overlay.
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await expect(page.locator(".loading-page--before-hide")).toHaveCount(0);
}

/** The explorer tree row of a storage-relative path. */
export function treeRow(page: Page, storagePath: string): Locator {
  return page.getByTestId(`tree-row-${storagePath}`);
}

/**
 * Opens the right-click menu of a tree row and returns the menu. A busy row is aria-disabled, which
 * Playwright's click waits on forever, so those need `isBusy` to skip that check.
 */
export async function openRowMenu(page: Page, storagePath: string, { isBusy = false } = {}): Promise<Locator> {
  await waitForPageReady(page);
  await treeRow(page, storagePath).click({ button: "right", force: isBusy });
  const menu = page.getByTestId("explorer-context-menu");
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Confirms the password for the signed-in session, as the step-up dialog would. On the local
 * network a server asks once per session before an upload or download; the page and `request`
 * share the session, so the browser won't ask afterwards.
 */
export async function confirmSessionPassword(request: APIRequestContext): Promise<void> {
  const response = await request.post("/api/auth/confirm", {
    data: { password: ADMIN_PASSWORD, action: "upload", resource: "e2e" },
  });
  if (!response.ok()) throw new Error(`Password confirmation refused: ${response.status()} ${await response.text()}`);
}
