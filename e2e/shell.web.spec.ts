import { existsSync, readFileSync } from "node:fs";
import { ADMIN_PASSWORD, ADMIN_USERNAME, FIRST_STORAGE_LABEL, SECOND_STORAGE_LABEL } from "./support/environment";
import { expect, openRowMenu, test, treeRow } from "./support/fixtures";

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the API refuses a request without a session", async ({ request }) => {
    expect((await request.get("/api/storages")).status()).toBe(401);
    expect((await request.get("/api/jobs")).status()).toBe(401);
  });

  test("the sign-in page shows the version, refuses a wrong password and signs in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(version, { exact: false }).first()).toBeVisible();

    await page.getByLabel("Username").fill(ADMIN_USERNAME);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByText(/username or password is wrong/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel("Password").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByTestId("drives-dashboard")).toBeVisible();
  });
});

test("the server reports this version in server mode", async ({ request }) => {
  const health = (await (await request.get("/api/health")).json()) as { ok: boolean; version: string; mode: string };
  expect(health).toMatchObject({ ok: true, version, mode: "server" });
});

test("the dashboard shows the version and both storages", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("app-version")).toHaveText(`CMM ${version}`);
  const dashboard = page.getByTestId("drives-dashboard");
  await expect(dashboard.getByText(FIRST_STORAGE_LABEL, { exact: true })).toBeVisible();
  await expect(dashboard.getByText(SECOND_STORAGE_LABEL, { exact: true })).toBeVisible();
});

test("the explorer menu has Move to… but not the desktop-only items on a server", async ({ page, workspace }) => {
  workspace.writeText("a.txt");
  await page.goto(workspace.url("a.txt"));
  const menu = await openRowMenu(page, workspace.path("a.txt"));
  await expect(menu.getByTestId("menu-move")).toHaveAttribute("aria-disabled", "false");
  await expect(menu.getByTestId("menu-copy-path")).toHaveCount(0);
  await expect(menu.getByTestId("menu-reveal")).toHaveCount(0);
});

test("a file can be created, renamed and moved to the Trash from the tree", async ({ page, workspace }) => {
  workspace.makeFolder("docs");
  await page.goto(workspace.url("docs"));

  const menu = await openRowMenu(page, workspace.path("docs"));
  await menu.getByTestId("menu-new-file").click();
  await page.getByTestId("inline-name-input").fill("fresh.txt");
  await page.getByTestId("inline-name-input").press("Enter");
  await expect.poll(() => existsSync(workspace.disk("docs", "fresh.txt"))).toBe(true);
  await expect(treeRow(page, workspace.path("docs", "fresh.txt"))).toBeVisible();

  await treeRow(page, workspace.path("docs", "fresh.txt")).click();
  await page.keyboard.press("F2");
  const renameInput = page.getByTestId("inline-name-input");
  await renameInput.fill("renamed.txt");
  await renameInput.press("Enter");
  await expect.poll(() => existsSync(workspace.disk("docs", "renamed.txt"))).toBe(true);
  expect(existsSync(workspace.disk("docs", "fresh.txt"))).toBe(false);

  await treeRow(page, workspace.path("docs", "renamed.txt")).click();
  await page.keyboard.press("Delete");
  await page.getByTestId("delete-dialog").getByRole("button", { name: "Move to Trash" }).click();
  await expect.poll(() => existsSync(workspace.disk("docs", "renamed.txt"))).toBe(false);
  await expect(treeRow(page, workspace.path("docs", "renamed.txt"))).toHaveCount(0);
});
