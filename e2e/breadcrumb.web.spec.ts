import { FIRST_STORAGE_LABEL } from "./support/environment";
import { expect, test } from "./support/fixtures";

const DEEP_FOLDERS = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];

test("a shallow path keeps the clickable breadcrumb", async ({ page, workspace }) => {
  workspace.makeFolder("docs");
  await page.goto(workspace.url("docs"));
  const trail = page.getByTestId("breadcrumb");
  await expect(trail).toBeVisible();
  await expect(trail).not.toHaveAttribute("data-collapsed", "true");
  await expect(trail.getByRole("link", { name: "Drives" })).toBeVisible();
  await expect(trail.getByRole("link", { name: FIRST_STORAGE_LABEL, exact: true })).toBeVisible();
  await expect(trail.getByRole("link", { name: workspace.name, exact: true })).toBeVisible();
  await expect(trail.locator('[aria-current="page"]')).toHaveText("docs");
  await expect(page.getByTestId("breadcrumb-back")).toHaveCount(0);
});

test("a deep path folds to Back and the current item, with the full path one click away", async ({
  page,
  workspace,
}) => {
  await page.setViewportSize({ width: 2560, height: 1000 });
  workspace.writeText(`${DEEP_FOLDERS.join("/")}/note.md`, "# deep\n");
  await page.goto(workspace.url(...DEEP_FOLDERS, "note.md"));

  const trail = page.getByTestId("breadcrumb");
  await expect(trail).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("breadcrumb-current")).toHaveText("note.md");
  await expect(page.getByTestId("breadcrumb-current")).toHaveAttribute(
    "title",
    [FIRST_STORAGE_LABEL, workspace.name, ...DEEP_FOLDERS, "note.md"].join(" › "),
  );
  const overflow = await trail.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

  /* Back is a real link, one level up, and works from the keyboard. */
  const back = page.getByTestId("breadcrumb-back");
  await expect(back).toHaveAccessibleName("Back to l8");
  await expect(back).toHaveAttribute("href", workspace.url(...DEEP_FOLDERS));
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/l8$`));
  await expect(page.getByTestId("breadcrumb-current")).toHaveText("l8");
  await expect(page.getByTestId("breadcrumb-back")).toHaveAccessibleName("Back to l7");

  /* The … menu lists the whole path as links; picking one goes there. */
  await page.getByRole("button", { name: "Show the full path" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(2 + DEEP_FOLDERS.length - 1);
  await page.getByRole("menuitem", { name: "l2", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/l1/l2$`));
});

test("a trail that does not fit folds when the window narrows and unfolds when it widens", async ({
  page,
  workspace,
}) => {
  const longFolders = ["research-notes-archive", "quarterly-planning-docs"];
  workspace.writeText(`${longFolders.join("/")}/note.md`, "# long\n");
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto(workspace.url(...longFolders, "note.md"));
  const trail = page.getByTestId("breadcrumb");
  await expect(trail).not.toHaveAttribute("data-collapsed", "true");
  await expect(trail.getByRole("link", { name: "research-notes-archive" })).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 1000 });
  await expect(trail).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("breadcrumb-current")).toHaveText("note.md");
  await expect(page.getByTestId("breadcrumb-back")).toHaveAccessibleName("Back to quarterly-planning-docs");
  const narrow = await trail.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(narrow.scroll).toBeLessThanOrEqual(narrow.client);

  await page.setViewportSize({ width: 2560, height: 1000 });
  await expect(trail).not.toHaveAttribute("data-collapsed", "true");
});

test("below the desktop width the trail is hidden and the page does not scroll sideways", async ({
  page,
  workspace,
}) => {
  workspace.writeText(`${DEEP_FOLDERS.join("/")}/note.md`);
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.goto(workspace.url(...DEEP_FOLDERS, "note.md"));
  await expect(page.getByTestId("breadcrumb")).toBeHidden();
  const horizontalScroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(horizontalScroll).toBeLessThanOrEqual(0);
});
