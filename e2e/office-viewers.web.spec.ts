import { readJson } from "./support/api";
import { expect, test, waitForPageReady } from "./support/fixtures";
import { writeDamagedWordDocument, writeWordDocument, writeWorkbook } from "./support/office-files";

/*
 * Office files: xlsx and docx are read in the browser; pptx and older formats go through
 * LibreOffice on the server (in this run, `CMM_SOFFICE_PATH=e2e/support/fake-soffice.sh` stands in
 * for it; without it, the placeholder says how to get LibreOffice).
 */

test("an xlsx shows its sheets as tables, with a tab per sheet", async ({ page, workspace }) => {
  workspace.makeFolder("office");
  await writeWorkbook(workspace.disk("office", "budget.xlsx"));
  await page.goto(workspace.url("office", "budget.xlsx"));
  await waitForPageReady(page);
  const viewer = page.getByTestId("spreadsheet-viewer");
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  await expect(viewer).toContainText("Rent");
  await expect(viewer).toContainText("1200");
  await expect(viewer).toContainText("350.5");
  await expect(page.getByTestId("sheet-tab")).toHaveText(["Budget", "Notes"]);
  await page.getByTestId("sheet-tab").filter({ hasText: "Notes" }).click();
  await expect(viewer).toContainText("Remember the second sheet");
});

test("a docx is laid out as pages, and a javascript: link in it is inert", async ({ page, workspace }) => {
  workspace.makeFolder("office");
  await writeWordDocument(workspace.disk("office", "report.docx"));
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto(workspace.url("office", "report.docx"));
  await waitForPageReady(page);
  const pages = page.getByTestId("document-pages");
  await expect(pages).toContainText("Quarterly report", { timeout: 15_000 });
  await expect(pages).toContainText("Revenue grew steadily");
  await expect(pages).toContainText("North");
  await expect(pages.locator('a[href="https://example.com/handbook"]')).toHaveCount(1);
  await expect(pages.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(pages.locator("script, iframe, object, embed")).toHaveCount(0);
  await pages.getByText("Do not click").click();
  expect(dialogs).toEqual([]);
});

test("a pptx is shown as a PDF made by LibreOffice, or says how to get LibreOffice", async ({
  page,
  request,
  workspace,
}) => {
  workspace.writeText("office/deck.pptx", "PK not really a deck, the stand-in converter doesn't mind");
  const office = await readJson<{ installed: boolean }>(await request.get("/api/office/status?force=1"));
  await page.goto(workspace.url("office", "deck.pptx"));
  await waitForPageReady(page);
  if (office.installed) {
    await expect(page.getByTestId("office-viewer")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("office-viewer").locator("canvas").first()).toBeVisible();
    // A second look comes from the cache.
    const cached = await request.get(
      `/api/office/preview?storageId=${workspace.firstStorageId}&path=${encodeURIComponent(workspace.path("office", "deck.pptx"))}`,
    );
    expect(cached.headers()["content-type"]).toBe("application/pdf");
  } else {
    await expect(page.getByTestId("placeholder-message")).toContainText("needs LibreOffice");
  }
});

test("a file LibreOffice can't convert says so, with Download", async ({ page, request, workspace }) => {
  const office = await readJson<{ installed: boolean }>(await request.get("/api/office/status"));
  test.skip(!office.installed, "needs LibreOffice (or the e2e stand-in)");
  workspace.makeFolder("office");
  writeDamagedWordDocument(workspace.disk("office", "broken.doc"));
  await page.goto(workspace.url("office", "broken.doc"));
  await expect(page.getByText(/LibreOffice couldn't convert this file/)).toBeVisible({ timeout: 30_000 });
});
