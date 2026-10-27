import type { Page } from "@playwright/test";
import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, waitForPageReady } from "./support/fixtures";
import { writeWorkbook } from "./support/office-files";

/*
 * Light / Dark / System: the choice applies at once, is saved for the user, and the server renders
 * the next page in it (no dark flash). Dark stays the default. The screenshots of the main screens
 * in both themes are kept with the test results for review.
 */

const DARK_CANVAS = "rgb(4, 16, 26)";
const LIGHT_CANVAS = "rgb(242, 246, 249)";

function readCanvas(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

test.afterEach(async ({ request }) => {
  // The e2e admin is shared by every test: leave it on the default theme.
  await request.put("/api/users/me/theme", { data: { theme: "dark" } });
});

test("Dark is the default; Light applies at once, is saved, and renders on the server", async ({ page, request }) => {
  await request.put("/api/users/me/theme", { data: { theme: "dark" } });
  await page.goto("/");
  await waitForPageReady(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await readCanvas(page)).toBe(DARK_CANVAS);

  await page.getByTestId("account-menu").click();
  await page.getByTestId("theme-light").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => readCanvas(page)).toBe(LIGHT_CANVAS);
  await expect
    .poll(async () => (await readJson<{ user: { theme: string } }>(await page.request.get("/api/auth/me"))).user.theme)
    .toBe("light");

  // The server renders the page light: the HTML itself says so, before any script runs.
  const html = await (await page.request.get("/")).text();
  expect(html).toMatch(/<html[^>]*data-theme="light"/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await readCanvas(page)).toBe(LIGHT_CANVAS);
});

test("System follows the computer's appearance", async ({ page }) => {
  await page.goto("/settings/general");
  await waitForPageReady(page);
  await page.getByTestId("theme-system").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => readCanvas(page)).toBe(LIGHT_CANVAS);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => readCanvas(page)).toBe(DARK_CANVAS);
});

test("screenshots of the main screens in both themes", async ({ page, request, workspace }, testInfo) => {
  workspace.writeText(
    "notes/plan.md",
    "# Plan\n\n- **Bold** item with `code`\n- [A link](https://example.com)\n\n```ts\nconst answer = 42;\n```\n",
  );
  workspace.writeText(
    "notes/script.ts",
    "export function greet(name: string): string {\n  return `Hello ${name}`; // comment\n}\n",
  );
  workspace.writeText("notes/data.csv", "name,amount,date\nRent,1200,2024-03-01\nFood,350.5,2024-03-02\n");
  await writeWorkbook(workspace.disk("notes", "budget.xlsx"));
  const enable = await request.put("/api/settings/terminal.enabled", {
    data: { value: true, password: ADMIN_PASSWORD },
  });
  expect(enable.ok()).toBe(true);
  const opened = await request.post("/api/terminals", {
    data: { storageId: workspace.firstStorageId, path: workspace.name },
  });
  const terminalId = opened.ok() ? (await readJson<{ terminal: { id: string } }>(opened)).terminal.id : undefined;
  try {
    for (const theme of ["light", "dark"] as const) {
      await request.put("/api/users/me/theme", { data: { theme } });
      for (const [name, target] of [
        ["markdown", workspace.url("notes", "plan.md")],
        ["code", workspace.url("notes", "script.ts")],
        ["csv", workspace.url("notes", "data.csv")],
        ["xlsx", workspace.url("notes", "budget.xlsx")],
        ["settings", "/settings/general"],
        ["dashboard", "/"],
      ] as const) {
        await page.goto(target);
        await waitForPageReady(page);
        await page.waitForTimeout(700);
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${name}.png`) });
      }
      await page.goto(workspace.url("notes", "plan.md"));
      await waitForPageReady(page);
      await page.getByTestId("account-menu").click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath(`${theme}-account-menu.png`) });
    }
  } finally {
    if (terminalId) await request.delete(`/api/terminals/${terminalId}`);
    await request.put("/api/settings/terminal.enabled", { data: { value: false } });
  }
});
