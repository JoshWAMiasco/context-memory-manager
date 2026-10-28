import type { Page } from "@playwright/test";
import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, treeRow, waitForPageReady } from "./support/fixtures";

/*
 * CMM on a phone (412×915, touch): the top bar fits without overflowing, the page links are in a
 * bottom bar and the account and system actions in a menu drawer; the explorer shows Files, the
 * file pane and Terminal one at a time; the terminal has a key bar for the arrows, Enter and Esc,
 * and types what a composing (Android) keyboard settles on, and scrolls with a swipe; and the
 * Markdown toolbar stays on one row that fits the screen.
 */
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

const SCREENSHOTS = process.env.CMM_E2E_SCREENSHOTS;

async function snap(page: Page, name: string): Promise<void> {
  if (!SCREENSHOTS) return;
  // Let drawers finish sliding in.
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SCREENSHOTS}/${name}.png` });
}

/** Nothing on the page is wider than the screen. */
async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("the top bar fits, with a bottom bar and a menu drawer", async ({ page }) => {
  await page.goto("/");
  await waitForPageReady(page);
  await expectNoHorizontalOverflow(page);
  const avatar = page.getByTestId("mobile-account-button");
  await expect(avatar).toBeVisible();
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox && avatarBox.x + avatarBox.width <= 412).toBe(true);
  // The desktop-only controls are out of the top bar.
  await expect(page.getByTestId("nav-settings")).toBeHidden();
  await expect(page.getByTestId("account-menu")).toBeHidden();

  const bottomBar = page.getByTestId("mobile-bottom-bar");
  await expect(bottomBar).toBeVisible();
  await expect(page.getByTestId("bottom-drives")).toHaveAttribute("aria-current", "page");
  await snap(page, "drives");

  await page.getByTestId("bottom-menu").click();
  const drawer = page.getByTestId("mobile-menu-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("e2e-admin");
  await expect(page.getByTestId("drawer-version")).toContainText(/CMM \d+\.\d+\.\d+/);
  await expect(drawer.getByTestId("theme-switch")).toBeVisible();
  await snap(page, "drawer");
  await drawer.getByTestId("drawer-settings").click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(drawer).toBeHidden();

  await page.getByTestId("bottom-trash").click();
  await expect(page).toHaveURL(/\/trash$/);
  await page.getByTestId("bottom-search").click();
  await expect(page.getByPlaceholder("Search drives, folders and files…")).toBeVisible();
});

test("the explorer shows Files, the file and Terminal one at a time", async ({ page, workspace }) => {
  workspace.writeText("notes/plan.md", "# Plan\n\nSome **bold** text.\n");
  await page.goto(workspace.url("notes"));
  await waitForPageReady(page);
  const stacked = page.getByTestId("stacked-view");
  await expect(stacked).toHaveAttribute("data-view", "pane");
  await expectNoHorizontalOverflow(page);
  await expect(page.getByTestId("pane-title")).toBeInViewport();
  await snap(page, "explorer-pane");

  await page.getByTestId("stacked-tab-files").click();
  await expect(stacked).toHaveAttribute("data-view", "files");
  // Selecting a folder keeps the tree in view.
  await treeRow(page, workspace.path("notes")).click();
  await expect(stacked).toHaveAttribute("data-view", "files");
  await snap(page, "explorer-files");
  await treeRow(page, workspace.path("notes", "plan.md")).click();
  // Opening a file shows it.
  await expect(stacked).toHaveAttribute("data-view", "pane");
  await expect(page.getByTestId("stacked-tab-pane")).toContainText("plan.md");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByTestId("markdown-toolbar")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, "markdown");

  // The Markdown toolbar is one row that fits, scrolling sideways, with the mode switch in view.
  const toolbar = page.getByTestId("markdown-toolbar");
  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox && toolbarBox.height).toBeLessThanOrEqual(48);
  expect(toolbarBox && toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(412);
  await expect(page.getByTestId("mode-source")).toBeInViewport();
  await page.getByTestId("toolbar-table").click();
  await expect(page.getByRole("menu", { name: "Table" })).toBeInViewport();
  await snap(page, "markdown-table-menu");
});

test("the terminal has keys a phone keyboard lacks", async ({ page, request, workspace }) => {
  const enable = await request.put("/api/settings/terminal.enabled", {
    data: { value: true, password: ADMIN_PASSWORD },
  });
  expect(enable.ok()).toBe(true);
  let terminalId: string | undefined;
  try {
    const listing = await readJson<{ available: boolean; unavailableReason?: string }>(
      await request.get("/api/terminals"),
    );
    test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");
    // A menu driven by the arrow keys, like Claude Code's: it prints the item Enter picked.
    workspace.writeText(
      "menu.js",
      [
        "const items = ['No, exit', 'Yes, I trust this folder'];",
        "let at = 0;",
        "const draw = () => process.stdout.write('\\r\\x1b[K> ' + items[at]);",
        "process.stdin.setRawMode(true); process.stdin.resume(); draw();",
        "process.stdin.on('data', (data) => {",
        "  const key = data.toString();",
        "  if (key === '\\x1b[B' || key === '\\x1bOB') at = Math.min(at + 1, items.length - 1);",
        "  else if (key === '\\x1b[A' || key === '\\x1bOA') at = Math.max(at - 1, 0);",
        "  else if (key === '\\r') { process.stdout.write('\\r\\nPICKED ' + items[at] + '\\r\\n'); process.exit(0); }",
        "  draw();",
        "});",
      ].join("\n"),
    );
    await page.goto(workspace.url());
    await waitForPageReady(page);
    await page.evaluate(() => window.localStorage.removeItem("cmm.terminal-dock"));
    await page.reload();
    await waitForPageReady(page);
    await page.getByTestId("stacked-tab-terminal").click();
    await page.getByTestId("stacked-open-terminal").click();
    const stacked = page.getByTestId("stacked-view");
    await expect(stacked).toHaveAttribute("data-view", "terminal");
    const docked = page.getByTestId("docked-terminal").first();
    terminalId = (await docked.getAttribute("data-terminal-id")) ?? undefined;
    // No floating panel over the explorer on a phone.
    await expect(page.getByTestId("terminal-panel")).toHaveCount(0);
    const screen = docked.locator(".xterm-rows");
    await expect(screen).not.toBeEmpty({ timeout: 30_000 });
    await docked.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("node menu.js\n");
    await expect(screen).toContainText("> No, exit", { timeout: 15_000 });

    const keyBar = docked.getByTestId("terminal-key-bar");
    await expect(keyBar).toBeVisible();
    await snap(page, "terminal");
    await keyBar.getByTestId("terminal-key-down").click();
    await expect(screen).toContainText("> Yes, I trust this folder");
    await keyBar.getByTestId("terminal-key-enter").click();
    await expect(screen).toContainText("PICKED Yes, I trust this folder");

    // Ctrl then a typed letter sends the control character: Ctrl+C stops `sleep`.
    await page.keyboard.type("sleep 30\n");
    await keyBar.getByTestId("terminal-key-control").click();
    await expect(keyBar.getByTestId("terminal-key-control")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.type("c");
    await expect(keyBar.getByTestId("terminal-key-control")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.type("echo after-$((40+2))\n");
    await expect(screen).toContainText("after-42", { timeout: 15_000 });

    /*
     * An Android keyboard composes each word in the text area and autocorrects it after a space
     * by rewriting it there ("imw " becomes "ime "): the shell gets the corrected line once.
     */
    const cdp = await page.context().newCDPSession(page);
    await docked.locator(".xterm-helper-textarea").evaluate((textarea: HTMLTextAreaElement) => {
      const fire = (event: Event) => textarea.dispatchEvent(event);
      const compose = (before: string, steps: string[]) => {
        fire(new CompositionEvent("compositionstart", { data: "" }));
        for (const word of steps) {
          fire(new KeyboardEvent("keydown", { key: "Unidentified", keyCode: 229, bubbles: true }));
          textarea.value = before + word;
          fire(new CompositionEvent("compositionupdate", { data: word }));
          fire(new InputEvent("input", { inputType: "insertCompositionText", data: word, isComposing: true, bubbles: true }));
        }
        fire(new CompositionEvent("compositionend", { data: steps.at(-1) }));
      };
      const typeSpace = () => {
        fire(new KeyboardEvent("keydown", { key: "Unidentified", keyCode: 229, bubbles: true }));
        textarea.value += " ";
        fire(new InputEvent("input", { inputType: "insertText", data: " ", bubbles: true }));
      };
      compose("", ["e", "ec", "ech", "echo"]);
      typeSpace();
      compose("echo ", ["i", "im", "imw"]);
      typeSpace();
      compose("echo ", ["ime "]);
    });
    await page.keyboard.type("$((6*7))\n");
    await expect(screen).toContainText("$ echo ime $((6*7))ime 42", { timeout: 15_000 });

    // A swipe down scrolls back through the output, like the scroll wheel.
    await page.keyboard.type("for i in $(seq 1 120); do echo row-$i-end; done\n");
    await expect(screen).toContainText("row-120-end", { timeout: 15_000 });
    await expect(screen).not.toContainText("row-60-end");
    const screenBox = await screen.boundingBox();
    if (!screenBox) throw new Error("The terminal screen has no box.");
    const x = screenBox.x + screenBox.width / 2;
    for (let swipe = 0; swipe < 4; swipe += 1) {
      const y = screenBox.y + 20;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let step = 1; step <= 10; step += 1) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + step * 20 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }
    await expect(screen).toContainText("row-60-end");
  } finally {
    if (terminalId) await request.delete(`/api/terminals/${terminalId}`);
    await request.put("/api/settings/terminal.enabled", { data: { value: false } });
  }
});
