import { realpathSync } from "node:fs";
import path from "node:path";
import { expect, openRowMenu, test, treeRow } from "./support/fixtures";
import { DESKTOP } from "./support/environment";

/*
 * Desktop mode served to a browser: the page sees the desktop bridge the Electron preload would
 * give it (faked here), so "Copy full path" and the file manager items appear. The Electron app
 * itself is not started.
 */
test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: DESKTOP.baseUrl });
  await context.addInitScript(() => {
    Object.assign(window, {
      cmmDesktop: {
        isDesktop: true,
        platform: "darwin",
        appVersion: "e2e",
        pickFolder: async () => null,
        revealPath: async () => true,
        openFolder: async () => true,
        openExternal: async () => true,
        getPathForFile: () => null,
        setTheme: () => undefined,
      },
    });
  });
});

async function readClipboard(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test("Copy full path puts a file's absolute path on the clipboard and confirms", async ({ page, workspace }) => {
  workspace.writeText("docs/note.txt", "hello\n");
  await page.goto(workspace.url("docs", "note.txt"));
  const menu = await openRowMenu(page, workspace.path("docs", "note.txt"));
  await expect(menu.getByTestId("menu-reveal")).toBeVisible();
  await expect(menu.getByTestId("menu-copy-path")).toHaveAttribute("aria-disabled", "false");
  await menu.getByTestId("menu-copy-path").click();

  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  const copied = await readClipboard(page);
  expect(path.isAbsolute(copied)).toBe(true);
  expect(realpathSync(copied)).toBe(realpathSync(workspace.disk("docs", "note.txt")));
});

test("Copy full path works for a folder", async ({ page, workspace }) => {
  workspace.makeFolder("docs/inner");
  await page.goto(workspace.url("docs", "inner"));
  const menu = await openRowMenu(page, workspace.path("docs"));
  await menu.getByTestId("menu-copy-path").click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  expect(realpathSync(await readClipboard(page))).toBe(realpathSync(workspace.disk("docs")));
});

test("Copy full path is for one item: with several selected it is disabled with the reason", async ({
  page,
  workspace,
}) => {
  workspace.writeText("a.txt");
  workspace.writeText("b.txt");
  await page.goto(workspace.url("a.txt"));
  await treeRow(page, workspace.path("a.txt")).click();
  await treeRow(page, workspace.path("b.txt")).click({ modifiers: ["ControlOrMeta"] });
  const menu = await openRowMenu(page, workspace.path("b.txt"));
  await expect(menu.getByTestId("menu-copy-path")).toHaveAttribute("aria-disabled", "true");
  await expect(menu.getByTestId("menu-copy-path")).toHaveAttribute("title", "Select one item to copy its path.");
});

test("the absolute-path route stays inside the storage jail", async ({ request, workspace }) => {
  workspace.writeText("note.txt");
  const inside = await request.get(
    `/api/fs/abs-path?storageId=${workspace.firstStorageId}&path=${encodeURIComponent(workspace.path("note.txt"))}`,
  );
  expect(inside.ok()).toBe(true);
  for (const escape of ["../../../../etc/passwd", `${workspace.name}/../../../..`, "/etc/passwd"]) {
    const outside = await request.get(
      `/api/fs/abs-path?storageId=${workspace.firstStorageId}&path=${encodeURIComponent(escape)}`,
    );
    expect(outside.ok(), `path "${escape}" must not resolve`).toBe(false);
    expect(await outside.text()).not.toContain("/etc/passwd");
  }
});
