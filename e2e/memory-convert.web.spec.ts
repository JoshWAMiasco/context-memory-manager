import { existsSync, readFileSync } from "node:fs";
import { readJson } from "./support/api";
import { expect, test, type Workspace } from "./support/fixtures";

function readManifestKind(workspace: Workspace, folder: string): string {
  const manifest = workspace.disk(folder, ".cmm", "manifest.json");
  return existsSync(manifest) ? (JSON.parse(readFileSync(manifest, "utf8")) as { kind: string }).kind : "(none)";
}

test("a memory card converts to a normal folder, leaves the list, and can be tagged again", async ({
  page,
  request,
  workspace,
}) => {
  const memoryName = `Persona ${workspace.name}`;
  const created = await request.post("/api/memory", {
    data: { storageId: workspace.firstStorageId, parentPath: workspace.name, folderName: "persona", name: memoryName },
  });
  expect(created.ok()).toBe(true);
  workspace.writeText("persona/notes.md", "# keep me\n");
  expect(readManifestKind(workspace, "persona")).toBe("memory");

  const card = page.getByTestId(`memory-card-${workspace.firstStorageId}-${workspace.path("persona")}`);
  await page.goto("/");
  await expect(card).toBeVisible();

  /* Right-click opens the card's menu; Escape closes it. */
  await card.click({ button: "right" });
  const menu = page.getByTestId("memory-card-menu");
  await expect(menu.getByTestId("menu-open-memory")).toBeVisible();
  await expect(menu.getByTestId("menu-open-in-storage")).toBeVisible();
  await expect(menu.getByTestId("menu-convert-folder")).toHaveText("Convert to normal folder");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  /* Cancelling the confirmation changes nothing. */
  await card.click({ button: "right" });
  await menu.getByTestId("menu-convert-folder").click();
  const dialog = page.getByTestId("convert-folder-dialog");
  await expect(page.getByText(`Convert "${memoryName}" to a normal folder?`)).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toBeVisible();
  expect(readManifestKind(workspace, "persona")).toBe("memory");

  /* The card's … button opens the same menu; confirming converts it. */
  await card.getByTestId("memory-card-actions").click();
  await menu.getByTestId("menu-convert-folder").click();
  await dialog.getByRole("button", { name: "Convert to normal folder" }).click();
  await expect(page.getByText("Memory is now a normal folder")).toBeVisible();
  await expect(card).toHaveCount(0);

  /* The folder and its files are untouched; only the memory tag is gone. */
  expect(existsSync(workspace.disk("persona"))).toBe(true);
  expect(readFileSync(workspace.disk("persona", "notes.md"), "utf8")).toBe("# keep me\n");
  expect(readManifestKind(workspace, "persona")).not.toBe("memory");

  /* A reload still does not list it. */
  await page.reload();
  await expect(page.getByTestId("memories-group")).toBeVisible();
  await expect(card).toHaveCount(0);

  /* Tagging it again through the existing flow brings the card back. */
  const converted = await request.post("/api/memory/convert", {
    data: { storageId: workspace.firstStorageId, path: workspace.path("persona"), to: "memory", name: memoryName },
  });
  expect((await readJson<{ memory: { name: string } | null }>(converted)).memory?.name).toBe(memoryName);
  await page.reload();
  await expect(card).toBeVisible();
});

test("Open memory from the card menu opens the memory's own view", async ({ page, request, workspace }) => {
  const memoryName = `Viewer ${workspace.name}`;
  await request.post("/api/memory", {
    data: { storageId: workspace.firstStorageId, parentPath: workspace.name, folderName: "mem", name: memoryName },
  });
  await page.goto("/");
  const card = page.getByTestId(`memory-card-${workspace.firstStorageId}-${workspace.path("mem")}`);
  await card.click({ button: "right" });
  await page.getByTestId("menu-open-memory").click();
  await expect(page).toHaveURL(new RegExp(`/storage/${workspace.firstStorageId}/${workspace.name}/mem`));
  await expect(page.getByTestId("memory-tree-header")).toContainText(memoryName);
});
