import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cancelJob, listJobs, pauseJob, startMove, waitForJobToFinish } from "./support/api";
import { expect, openRowMenu, test, treeRow, waitForPageReady } from "./support/fixtures";

test("Move to… moves a file into another folder through the picker", async ({ page, workspace }) => {
  workspace.writeText("a.txt", "alpha\n");
  workspace.makeFolder("docs/sub");
  await page.goto(workspace.url("a.txt"));

  const menu = await openRowMenu(page, workspace.path("a.txt"));
  await menu.getByTestId("menu-move").click();
  const dialog = page.getByTestId("move-dialog");
  await expect(dialog).toBeVisible();

  /* It starts in the file's own folder, which is no move. */
  await expect(dialog.getByTestId("move-summary")).toContainText("already in this folder");
  await expect(dialog.getByTestId("move-confirm")).toBeDisabled();

  await dialog.getByTestId("move-folder-picker").getByRole("option", { name: "docs" }).click();
  await expect(dialog.getByTestId("move-summary")).toContainText("Move");
  await expect(dialog.getByTestId("move-confirm")).toBeEnabled();
  await dialog.getByTestId("move-confirm").click();

  await expect(dialog).toBeHidden();
  await expect.poll(() => existsSync(workspace.disk("docs", "a.txt"))).toBe(true);
  expect(existsSync(workspace.disk("a.txt"))).toBe(false);
  expect(readFileSync(workspace.disk("docs", "a.txt"), "utf8")).toBe("alpha\n");
  await expect(treeRow(page, workspace.path("a.txt"))).toHaveCount(0);
});

test("Move to… refuses a folder into itself or one of its own subfolders", async ({ page, workspace }) => {
  workspace.makeFolder("docs/sub");
  workspace.makeFolder("other");
  await page.goto(workspace.url("docs", "sub"));

  const menu = await openRowMenu(page, workspace.path("docs"));
  await menu.getByTestId("menu-move").click();
  const dialog = page.getByTestId("move-dialog");
  const picker = dialog.getByTestId("move-folder-picker");

  await picker.getByRole("option", { name: "docs" }).click();
  await expect(dialog.getByTestId("move-summary")).toContainText("can't be moved into itself");
  await expect(dialog.getByTestId("move-confirm")).toBeDisabled();

  await picker.getByRole("option", { name: "sub" }).click();
  await expect(dialog.getByTestId("move-summary")).toContainText("can't be moved into itself");
  await expect(dialog.getByTestId("move-confirm")).toBeDisabled();

  await picker.getByRole("button", { name: "Up one level" }).click();
  await picker.getByRole("button", { name: "Up one level" }).click();
  await picker.getByRole("option", { name: "other" }).click();
  await expect(dialog.getByTestId("move-confirm")).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(existsSync(workspace.disk("docs", "sub"))).toBe(true);
});

test("Move to… moves a multi-selection together", async ({ page, workspace }) => {
  for (const name of ["a.txt", "b.txt", "c.txt"]) workspace.writeText(name);
  workspace.makeFolder("docs");
  await page.goto(workspace.url("a.txt"));

  await treeRow(page, workspace.path("a.txt")).click();
  await treeRow(page, workspace.path("b.txt")).click({ modifiers: ["ControlOrMeta"] });
  const menu = await openRowMenu(page, workspace.path("b.txt"));
  await expect(menu.getByTestId("menu-move")).toContainText("Move 2 items to…");
  await menu.getByTestId("menu-move").click();

  const dialog = page.getByTestId("move-dialog");
  await dialog.getByTestId("move-folder-picker").getByRole("option", { name: "docs" }).click();
  await dialog.getByTestId("move-confirm").click();
  await expect(dialog).toBeHidden();

  await expect.poll(() => existsSync(workspace.disk("docs", "b.txt"))).toBe(true);
  expect(existsSync(workspace.disk("docs", "a.txt"))).toBe(true);
  expect(existsSync(workspace.disk("c.txt"))).toBe(true);
  expect(existsSync(workspace.disk("a.txt"))).toBe(false);
});

test("a cross-storage move keeps its source and target folders busy until it ends", async ({
  page,
  request,
  workspace,
}) => {
  workspace.makeBigFile("src/big.bin", 1536);
  workspace.writeText("src/other.txt");
  workspace.writeText("free/x.txt");
  mkdirSync(workspace.diskSecond("dst"), { recursive: true });
  writeFileSync(workspace.diskSecond("dst", "kept.txt"), "kept\n");

  const started = await startMove(
    request,
    [{ storageId: workspace.firstStorageId, path: workspace.path("src", "big.bin") }],
    { storageId: workspace.secondStorageId, path: workspace.path("dst") },
  );
  expect(started.job, "a move to another storage is a background job").toBeDefined();
  const jobId = started.job?.id ?? "";
  const paused = await pauseJob(request, jobId);
  expect(paused.locks).toEqual(
    expect.arrayContaining([
      { storageId: workspace.firstStorageId, path: workspace.path("src") },
      { storageId: workspace.secondStorageId, path: workspace.path("dst") },
    ]),
  );

  /* The source folder: every row is disabled and shows the spinner, neighbours are not. */
  await page.goto(workspace.url("src", "other.txt"));
  const busyRows = ["src", "src/other.txt", "src/big.bin"].map((relative) => treeRow(page, workspace.path(relative)));
  for (const row of busyRows) {
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(row.getByTestId("tree-row-busy")).toBeVisible();
    await expect(row).toHaveAttribute("draggable", "false");
  }
  await expect(treeRow(page, workspace.path("free"))).not.toHaveAttribute("aria-disabled", "true");
  await expect(treeRow(page, workspace.path("free"))).toHaveAttribute("draggable", "true");

  /* Clicking a busy row does nothing. */
  await waitForPageReady(page);
  await treeRow(page, workspace.path("src", "big.bin")).click({ force: true });
  await expect(treeRow(page, workspace.path("src", "big.bin"))).toHaveAttribute("aria-selected", "false");

  /* Actions on a busy row are disabled with the reason; copying (read-only) still works. */
  const menu = await openRowMenu(page, workspace.path("src", "other.txt"), { isBusy: true });
  for (const action of ["rename", "cut", "move", "delete"]) {
    await expect(menu.getByTestId(`menu-${action}`)).toHaveAttribute("aria-disabled", "true");
  }
  await expect(menu.getByTestId("menu-move")).toHaveAttribute("title", /being moved/i);
  await expect(menu.getByTestId("menu-copy")).toHaveAttribute("aria-disabled", "false");
  await page.keyboard.press("Escape");

  /* The target folder cannot be picked as a destination in the meantime. */
  await page.getByRole("button", { name: "Expand free" }).click();
  await expect(treeRow(page, workspace.path("free", "x.txt"))).toBeVisible();
  const freeMenu = await openRowMenu(page, workspace.path("free", "x.txt"));
  await freeMenu.getByTestId("menu-move").click();
  const dialog = page.getByTestId("move-dialog");
  await dialog.getByTestId("move-storage").selectOption({ label: "Second" });
  const picker = dialog.getByTestId("move-folder-picker");
  await picker.getByRole("option", { name: workspace.name, exact: true }).click();
  await picker.getByRole("option", { name: "dst" }).click();
  await expect(dialog.getByTestId("move-summary")).toContainText("Files are being moved here");
  await expect(dialog.getByTestId("move-confirm")).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  /* The other storage's explorer shows the target folder as busy too, and frees it live on cancel. */
  await page.goto(workspace.urlSecond("dst", "kept.txt"));
  const keptRow = treeRow(page, workspace.path("dst", "kept.txt"));
  await expect(keptRow).toHaveAttribute("aria-disabled", "true");
  await cancelJob(request, jobId);
  expect((await waitForJobToFinish(request, jobId)).status).toBe("cancelled");
  await expect(keptRow).not.toHaveAttribute("aria-disabled", "true");
  await expect(keptRow.getByTestId("tree-row-busy")).toHaveCount(0);

  /* A cancelled move leaves the source where it was, and its folder is free again. */
  expect(existsSync(workspace.disk("src", "big.bin"))).toBe(true);
  await page.goto(workspace.url("src", "other.txt"));
  await expect(treeRow(page, workspace.path("src", "other.txt"))).not.toHaveAttribute("aria-disabled", "true");
  const jobs = await listJobs(request);
  expect(jobs.find((job) => job.id === jobId)?.status).toBe("cancelled");
});

test("a finished cross-storage move frees both folders and refreshes the listings", async ({
  page,
  request,
  workspace,
}) => {
  workspace.writeText("src/small.txt", "small\n");
  workspace.writeText("src/stay.txt", "stay\n");
  mkdirSync(workspace.diskSecond("dst"), { recursive: true });
  await page.goto(workspace.url("src", "small.txt"));

  const menu = await openRowMenu(page, workspace.path("src", "small.txt"));
  await menu.getByTestId("menu-move").click();
  const dialog = page.getByTestId("move-dialog");
  await dialog.getByTestId("move-storage").selectOption({ label: "Second" });
  const picker = dialog.getByTestId("move-folder-picker");
  await picker.getByRole("option", { name: workspace.name, exact: true }).click();
  await picker.getByRole("option", { name: "dst" }).click();
  await expect(dialog.getByTestId("move-confirm")).toBeEnabled();
  await dialog.getByTestId("move-confirm").click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () =>
      (await listJobs(request)).find(
        (job) => job.type === "fs.copy" && job.locks?.some((lock) => lock.path === workspace.path("dst")),
      ),
    )
    .toBeDefined();
  const job = (await listJobs(request)).find(
    (listed) => listed.type === "fs.copy" && listed.locks?.some((lock) => lock.path === workspace.path("dst")),
  );
  expect((await waitForJobToFinish(request, job?.id ?? "")).status).toBe("done");

  expect(readFileSync(workspace.diskSecond("dst", "small.txt"), "utf8")).toBe("small\n");
  expect(existsSync(workspace.disk("src", "small.txt"))).toBe(false);
  await expect(treeRow(page, workspace.path("src", "small.txt"))).toHaveCount(0);
  await expect(treeRow(page, workspace.path("src", "stay.txt"))).toBeVisible();
  await expect(page.getByTestId("tree-row-busy")).toHaveCount(0);
  await expect(treeRow(page, workspace.path("src", "stay.txt"))).not.toHaveAttribute("aria-disabled", "true");
});
