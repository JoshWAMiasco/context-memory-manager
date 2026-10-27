import { readFileSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { readJson } from "./support/api";
import { confirmSessionPassword, expect, openRowMenu, test } from "./support/fixtures";

/*
 * Right-click → "Replace with file from computer…": the file keeps its name, the old version is
 * kept (a commit in a versioned folder, a trash copy elsewhere), and "See what changed" compares
 * text files. Office files can be replaced but aren't compared.
 */

async function replaceThroughMenu(page: Page, storagePath: string, file: { name: string; content: string }) {
  const menu = await openRowMenu(page, storagePath);
  const chooserPromise = page.waitForEvent("filechooser");
  await menu.getByTestId("menu-replace").click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: file.name, mimeType: "application/octet-stream", buffer: Buffer.from(file.content) });
}

test.beforeEach(async ({ request }) => {
  await confirmSessionPassword(request);
});

interface TrashListing {
  items: { id: string; name: string; originalPath: string }[];
}

test("in a folder without versioning, the old version goes to Trash and is compared", async ({
  page,
  request,
  workspace,
}) => {
  const filePath = workspace.writeText("notes/plan.md", "# Plan\n\nold line\n");
  await page.goto(workspace.url("notes", "plan.md"));
  await replaceThroughMenu(page, workspace.path("notes", "plan.md"), {
    name: "plan-from-laptop.md",
    content: "# Plan\n\nnew line\n",
  });

  await expect(page.getByText("Replaced plan.md")).toBeVisible();
  await expect(page.getByText("The previous version is in Trash.")).toBeVisible();
  await expect.poll(() => readFileSync(filePath, "utf8")).toBe("# Plan\n\nnew line\n");
  const trash = await readJson<TrashListing>(await request.get(`/api/trash?storageId=${workspace.firstStorageId}`));
  expect(trash.items.some((item) => item.originalPath === workspace.path("notes", "plan.md"))).toBe(true);

  await page.getByTestId("replace-see-changes").click();
  const comparison = page.getByTestId("trash-comparison");
  await expect(comparison).toBeVisible();
  await expect(comparison).toContainText("old line");
  await expect(comparison).toContainText("new line");
  await expect(page).toHaveURL(/changes=trash/);
});

test("in a versioned folder the replace is its own step, opened by See what changed", async ({
  page,
  request,
  workspace,
}) => {
  workspace.writeText("doc/readme.md", "first version\n");
  const enabled = await request.post("/api/versioning/enable", {
    data: { storageId: workspace.firstStorageId, path: workspace.path("doc") },
  });
  test.skip(!enabled.ok(), `versioning unavailable: ${await enabled.text()}`);

  await page.goto(workspace.url("doc", "readme.md"));
  await replaceThroughMenu(page, workspace.path("doc", "readme.md"), {
    name: "readme.md",
    content: "second version\n",
  });
  await expect(page.getByText("Replaced readme.md")).toBeVisible();
  await expect(page.getByText("The previous version is in its history.")).toBeVisible();
  await page.getByTestId("replace-see-changes").click();

  const panel = page.getByTestId("history-panel");
  await expect(panel).toBeVisible();
  const selected = panel.locator('[data-testid="history-commit"][aria-current="true"]');
  await expect(selected).toHaveAttribute("data-kind", "replace");
  await expect(page.getByTestId("history-commit-message")).toHaveText("Replace readme.md (uploaded)");
  await expect(page.getByTestId("history-detail")).toContainText("second version");
  await expect(page.getByTestId("history-detail")).toContainText("first version");

  await page.getByTestId("history-step-filter").selectOption("edits");
  await expect(panel.locator('[data-testid="history-commit"][data-kind="replace"]')).toHaveCount(0);
  await page.getByTestId("history-step-filter").selectOption("uploads");
  await expect(panel.locator('[data-testid="history-commit"][data-kind="replace"]')).toHaveCount(1);
});

test("a file changed after Replace was chosen is not overwritten", async ({ page, workspace }) => {
  const filePath = workspace.writeText("race/a.txt", "original\n");
  await page.goto(workspace.url("race", "a.txt"));
  const menu = await openRowMenu(page, workspace.path("race", "a.txt"));
  const chooserPromise = page.waitForEvent("filechooser");
  const statPromise = page.waitForResponse(
    (response) => response.url().includes("/api/fs/stat") && response.url().includes(encodeURIComponent("a.txt")),
  );
  await menu.getByTestId("menu-replace").click();
  const chooser = await chooserPromise;
  await statPromise;
  writeFileSync(filePath, "edited by someone else meanwhile\n");
  await chooser.setFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("mine\n") });

  await expect(page.getByText(/changed since you chose to replace it/)).toBeVisible();
  expect(readFileSync(filePath, "utf8")).toBe("edited by someone else meanwhile\n");
});

test("a different kind of file asks first; an Office file is replaced but not compared", async ({
  page,
  workspace,
}) => {
  const filePath = workspace.writeText("office/budget.xlsx", "PK-old-spreadsheet");
  await page.goto(workspace.url("office", "budget.xlsx"));
  await replaceThroughMenu(page, workspace.path("office", "budget.xlsx"), {
    name: "budget.docx",
    content: "PK-a-word-file",
  });
  const dialog = page.getByTestId("replace-type-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(readFileSync(filePath, "utf8")).toBe("PK-old-spreadsheet");

  await replaceThroughMenu(page, workspace.path("office", "budget.xlsx"), {
    name: "budget-v2.xlsx",
    content: "PK-new-spreadsheet",
  });
  await expect(page.getByText("Replaced budget.xlsx")).toBeVisible();
  await expect(page.getByTestId("replace-see-changes")).toHaveCount(0);
  await expect.poll(() => readFileSync(filePath, "utf8")).toBe("PK-new-spreadsheet");
});
