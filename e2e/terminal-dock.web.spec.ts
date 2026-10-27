import type { APIRequestContext, Page } from "@playwright/test";
import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, treeRow, waitForPageReady, type Workspace } from "./support/fixtures";

/*
 * A terminal docks beside the editor (File tree | Editor | Terminal), keeps its session and screen
 * when it moves, folds to a rail like the tree (⌘J), comes back after a reload, and undocks to the
 * floating dock at the bottom.
 */
const PAINTER = [
  "process.stdout.write('\\x1b[2J\\x1b[H');",
  "for (let line = 0; line < 5; line += 1) process.stdout.write('docked line ' + line + ' keep-me\\r\\n');",
  "let tick = 0;",
  "setInterval(() => { tick += 1; process.stdout.write('\\x1b[7;1Htick ' + (tick % 10)); }, 100);",
].join(" ");

let terminalId: string | undefined;

test.beforeEach(async ({ request }) => {
  const enable = await request.put("/api/settings/terminal.enabled", {
    data: { value: true, password: ADMIN_PASSWORD },
  });
  expect(enable.ok()).toBe(true);
});

test.afterEach(async ({ request }) => {
  if (terminalId) await request.delete(`/api/terminals/${terminalId}`);
  terminalId = undefined;
  await request.put("/api/settings/terminal.enabled", { data: { value: false } });
});

async function openTerminalWithPainter(page: Page, request: APIRequestContext, workspace: Workspace): Promise<string> {
  const listing = await readJson<{ available: boolean; unavailableReason?: string }>(
    await request.get("/api/terminals"),
  );
  test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");
  workspace.writeText("painter.js", `${PAINTER}\n`);
  workspace.writeText("notes/plan.md", "# plan\n");
  const opened = await request.post("/api/terminals", {
    data: { storageId: workspace.firstStorageId, path: workspace.name },
  });
  const id = (await readJson<{ terminal: { id: string } }>(opened)).terminal.id;
  await page.goto(workspace.url("notes", "plan.md"));
  await waitForPageReady(page);
  // Start from a clean dock: earlier tests may have docked terminals in this browser profile.
  await page.evaluate(() => window.localStorage.removeItem("cmm.terminal-dock"));
  await page.reload();
  await waitForPageReady(page);
  const floating = page.locator(`[data-testid="terminal-panel"][data-terminal-id="${id}"]`);
  await expect(floating.locator(".xterm-rows")).not.toBeEmpty({ timeout: 30_000 });
  await floating.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("node painter.js\n");
  await expect(floating.locator(".xterm-rows")).toContainText("docked line 4 keep-me", { timeout: 15_000 });
  return id;
}

test("dock, fold, reload and undock a terminal, keeping its screen", async ({ page, request, workspace }) => {
  terminalId = await openTerminalWithPainter(page, request, workspace);
  const floating = page.locator(`[data-testid="terminal-panel"][data-terminal-id="${terminalId}"]`);
  await floating.getByRole("button", { name: "Dock beside the editor" }).click();

  const column = page.getByTestId("docked-terminals");
  await expect(column).toBeVisible();
  await expect(floating).toHaveCount(0);
  const dockedScreen = column.locator(`[data-testid="docked-terminal"][data-terminal-id="${terminalId}"] .xterm-rows`);
  for (let line = 0; line < 5; line += 1) await expect(dockedScreen).toContainText(`docked line ${line} keep-me`);
  // The column sits to the right of the editor.
  const paneBox = await page.getByTestId("file-pane").boundingBox();
  const columnBox = await column.boundingBox();
  expect(paneBox && columnBox && columnBox.x > paneBox.x).toBe(true);

  // ⌘J (Ctrl+J) folds it to its rail and back; the screen is still whole.
  await page.getByTestId("file-pane").click();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("terminal-show")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+j");
  await expect(page.getByTestId("terminal-show")).toHaveCount(0);
  await expect(dockedScreen).toContainText("docked line 0 keep-me");

  // Still docked after a reload.
  await page.reload();
  await waitForPageReady(page);
  await expect(page.getByTestId("docked-terminals")).toBeVisible();
  for (let line = 0; line < 5; line += 1) await expect(dockedScreen).toContainText(`docked line ${line} keep-me`);

  // A tree row dropped on the docked terminal pastes its path.
  await treeRow(page, workspace.path("notes", "plan.md")).dragTo(
    column.locator(`[data-testid="docked-terminal"][data-terminal-id="${terminalId}"]`),
  );
  await expect
    .poll(async () => ((await dockedScreen.textContent()) ?? "").replaceAll(/[\s ]/g, ""))
    .toContain(workspace.disk("notes", "plan.md").replaceAll(/\s/g, ""));

  // Undock: back to the floating dock, screen intact.
  await column.getByRole("button", { name: "Undock to the bottom" }).click();
  await expect(page.getByTestId("docked-terminals")).toHaveCount(0);
  await expect(floating).toBeVisible();
  await expect(floating.locator(".xterm-rows")).toContainText("docked line 0 keep-me");
});

test("on a narrow screen a docked terminal floats", async ({ page, request, workspace }) => {
  terminalId = await openTerminalWithPainter(page, request, workspace);
  await page
    .locator(`[data-testid="terminal-panel"][data-terminal-id="${terminalId}"]`)
    .getByRole("button", { name: "Dock beside the editor" })
    .click();
  await expect(page.getByTestId("docked-terminals")).toBeVisible();
  await page.setViewportSize({ width: 700, height: 900 });
  await expect(page.getByTestId("docked-terminals")).toHaveCount(0);
  await expect(page.locator(`[data-testid="terminal-panel"][data-terminal-id="${terminalId}"]`)).toBeVisible();
});
