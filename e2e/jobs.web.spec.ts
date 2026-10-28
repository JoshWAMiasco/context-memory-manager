import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, waitForPageReady } from "./support/fixtures";

/*
 * A terminal runs as a job: it leaves the dock, shows as a card on the Jobs page and the dashboard
 * (started, running for, location), opens across the whole page with its screen, can be opened in
 * the editor again, and is gone without a trace once discarded.
 */

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

test("run a terminal as a job, find it on Jobs and the dashboard, then discard it", async ({
  page,
  request,
  workspace,
}) => {
  const listing = await readJson<{ available: boolean; unavailableReason?: string }>(
    await request.get("/api/terminals"),
  );
  test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");
  workspace.writeText("notes/plan.md", "# plan\n");
  const opened = await request.post("/api/terminals", {
    data: { storageId: workspace.firstStorageId, path: workspace.name },
  });
  const terminal = (await readJson<{ terminal: { id: string; isJob: boolean; title: string } }>(opened)).terminal;
  terminalId = terminal.id;
  expect(terminal.isJob).toBe(false);

  await page.goto(workspace.url("notes", "plan.md"));
  await waitForPageReady(page);
  await page.evaluate(() => window.localStorage.removeItem("cmm.terminal-dock"));
  await page.reload();
  await waitForPageReady(page);
  const panel = page.locator(`[data-testid="terminal-panel"][data-terminal-id="${terminalId}"]`);
  await expect(panel.locator(".xterm-rows")).not.toBeEmpty({ timeout: 30_000 });
  await panel.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo job-marker-$((6*7))\n");
  await expect(panel.locator(".xterm-rows")).toContainText("job-marker-42");

  // Run as a job: it leaves the dock.
  await panel.getByRole("button", { name: /Run as a job/ }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText(`"${terminal.title}" runs as a job`)).toBeVisible();
  const listed = await readJson<{ terminals: { id: string; isJob: boolean }[] }>(await request.get("/api/terminals"));
  expect(listed.terminals.find((candidate) => candidate.id === terminalId)?.isJob).toBe(true);

  // A card on the dashboard opens it on the Jobs page, across the page, with its screen.
  await page.goto("/");
  await waitForPageReady(page);
  const dashboardCard = page.locator(`[data-testid="dashboard-jobs"] [data-terminal-id="${terminalId}"]`);
  await expect(dashboardCard.getByTestId("job-location")).toContainText(workspace.name);
  await expect(dashboardCard.getByTestId("job-status")).toHaveText("Running");
  await dashboardCard.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/jobs\\?id=${terminalId}`));
  const jobView = page.getByTestId("job-view");
  await expect(jobView.getByTestId("job-started")).toContainText("Started ");
  await expect(jobView.getByTestId("job-running-time")).toContainText("Running for ");
  await expect(jobView.locator(".xterm-rows")).toContainText("job-marker-42", { timeout: 30_000 });
  await expect(page.locator(`[data-testid="terminal-panel"][data-terminal-id="${terminalId}"]`)).toHaveCount(0);

  // The Jobs page lists it too.
  await page.goto("/jobs");
  await expect(page.locator(`[data-testid="job-card"][data-terminal-id="${terminalId}"]`)).toBeVisible();

  // Open in editor docks it beside the folder's editor, still a job.
  await page.locator(`[data-testid="job-card"][data-terminal-id="${terminalId}"]`).getByRole("link").click();
  await page.getByTestId("job-open-in-editor").click();
  await expect(page).toHaveURL(new RegExp(`/storage/`));
  const docked = page.locator(`[data-testid="docked-terminal"][data-terminal-id="${terminalId}"]`);
  await expect(docked.locator(".xterm-rows")).toContainText("job-marker-42", { timeout: 30_000 });

  // Discard: gone, with nothing left to find.
  await page.goto(`/jobs?id=${terminalId}`);
  await page.getByTestId("job-discard").click();
  await page.getByTestId("discard-job-dialog").getByRole("button", { name: "Discard job" }).click();
  await expect(page.getByTestId("jobs-page")).toBeVisible();
  await expect(page.getByTestId("no-jobs")).toBeVisible();
  const after = await readJson<{ terminals: { id: string }[] }>(await request.get("/api/terminals"));
  expect(after.terminals.some((candidate) => candidate.id === terminalId)).toBe(false);
  terminalId = undefined;
});
