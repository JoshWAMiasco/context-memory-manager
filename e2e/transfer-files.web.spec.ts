import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { encryptFolder } from "./support/crypto";
import { confirmSessionPassword, expect, openRowMenu, test, treeRow, waitForPageReady } from "./support/fixtures";

/*
 * Moving working files between the computer and the server: a folder uploads with everything in
 * it (OS clutter and .git left out), and several selected items download as one zip, after a
 * warning when encrypted files would be decrypted into it.
 */

test.beforeEach(async ({ request }) => {
  await confirmSessionPassword(request);
});

/** The names inside a zip, from the system's unzip. */
function listZip(zipPath: string): string[] {
  return execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).split("\n").filter(Boolean).toSorted();
}

test("Upload folder recreates the folder tree and leaves out OS clutter and .git", async ({
  page,
  workspace,
}, testInfo) => {
  const local = testInfo.outputPath("Project");
  for (const [relativePath, content] of [
    ["notes.md", "# notes\n"],
    ["docs/guide.md", "guide\n"],
    ["docs/deep/more.txt", "more\n"],
    [".DS_Store", "junk"],
    ["docs/Thumbs.db", "junk"],
    [".git/config", "[core]\n"],
  ] as const) {
    mkdirSync(path.dirname(path.join(local, relativePath)), { recursive: true });
    writeFileSync(path.join(local, relativePath), content);
  }
  workspace.makeFolder("inbox");
  await page.goto(workspace.url("inbox"));
  await waitForPageReady(page);
  const menu = await openRowMenu(page, workspace.path("inbox"));
  const chooserPromise = page.waitForEvent("filechooser");
  await menu.getByTestId("menu-upload-folder").click();
  await (await chooserPromise).setFiles(local);

  await expect(page.getByText(/items? were left out|item was left out/)).toBeVisible();
  await expect.poll(() => existsSync(workspace.disk("inbox", "Project", "docs", "deep", "more.txt"))).toBe(true);
  expect(readFileSync(workspace.disk("inbox", "Project", "docs", "guide.md"), "utf8")).toBe("guide\n");
  await expect.poll(() => existsSync(workspace.disk("inbox", "Project", "notes.md"))).toBe(true);
  expect(existsSync(workspace.disk("inbox", "Project", ".DS_Store"))).toBe(false);
  expect(existsSync(workspace.disk("inbox", "Project", "docs", "Thumbs.db"))).toBe(false);
  expect(existsSync(workspace.disk("inbox", "Project", ".git"))).toBe(false);
});

test("Uploading a folder again merges into it and asks once about names already taken", async ({
  page,
  workspace,
}, testInfo) => {
  const local = testInfo.outputPath("Reports");
  mkdirSync(local, { recursive: true });
  writeFileSync(path.join(local, "a.md"), "new a\n");
  writeFileSync(path.join(local, "b.md"), "new b\n");
  writeFileSync(path.join(local, "c.md"), "brand new\n");
  workspace.writeText("Reports/a.md", "old a\n");
  workspace.writeText("Reports/b.md", "old b\n");

  await page.goto(workspace.url());
  await waitForPageReady(page);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload a folder" }).click();
  await (await chooserPromise).setFiles(local);

  await expect(page.getByText("A file with this name is already in the folder")).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect.poll(() => readFileSync(workspace.disk("Reports", "a.md"), "utf8")).toBe("new a\n");
  await expect.poll(() => readFileSync(workspace.disk("Reports", "b.md"), "utf8")).toBe("new b\n");
  await expect.poll(() => existsSync(workspace.disk("Reports", "c.md"))).toBe(true);
  await expect(page.getByText("A file with this name is already in the folder")).toBeHidden();
});

test("several selected items download as one zip", async ({ page, workspace }) => {
  workspace.writeText("pick/one.md", "one\n");
  workspace.writeText("pick/folder/inner.txt", "inner\n");
  workspace.writeText("pick/other.md", "not selected\n");
  await page.goto(workspace.url("pick", "one.md"));
  await waitForPageReady(page);
  await treeRow(page, workspace.path("pick", "folder")).click({ modifiers: ["ControlOrMeta"] });
  const menu = await openRowMenu(page, workspace.path("pick", "folder"));
  await expect(menu.getByTestId("menu-download")).toHaveText(/Download 2 items as zip/);
  const downloadPromise = page.waitForEvent("download");
  await menu.getByTestId("menu-download").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/2 items\.zip$/);
  const zipPath = await download.path();
  expect(listZip(zipPath)).toEqual(["folder/", "folder/inner.txt", "one.md"]);
  await expect(page.getByText("Preparing the zip")).toBeVisible();
});

test("a folder zip with encrypted files asks first", async ({ page, request, workspace }) => {
  workspace.writeText("vault/secret.md", "secret\n");
  await encryptFolder(request, workspace.firstStorageId, workspace.path("vault"));
  await page.goto(workspace.url("vault"));
  await waitForPageReady(page);
  const menu = await openRowMenu(page, workspace.path("vault"));
  await menu.getByTestId("menu-download").click();
  const dialog = page.getByTestId("confirm-zip-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("1 of them is encrypted and will be decrypted");
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download zip" }).click();
  const zipPath = await (await downloadPromise).path();
  expect(execFileSync("unzip", ["-p", zipPath, "secret.md"], { encoding: "utf8" })).toBe("secret\n");
});
