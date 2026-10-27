import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, waitForPageReady } from "./support/fixtures";

/*
 * Programs like Claude Code repaint only the characters that change and trust the rest of the
 * screen to still be there. Minimizing a terminal panel and opening it again must keep the whole
 * screen, not just what changed meanwhile.
 */
const PAINTER = [
  "process.stdout.write('\\x1b[2J\\x1b[H');",
  "for (let line = 0; line < 8; line += 1) process.stdout.write('static line ' + line + ' keep-me\\r\\n');",
  "process.stdout.write('status (0s) tokens');",
  "let tick = 0;",
  "setInterval(() => { tick += 1; process.stdout.write('\\x1b[9;9H' + (tick % 10)); }, 150);",
  "if (process.argv[2] === 'heavy') for (let burst = 0; burst < 40000; burst += 1) process.stdout.write('\\x1b[9;9H' + (burst % 10));",
].join(" ");

test("a minimized terminal shows its whole screen again when it is opened", async ({ page, request, workspace }) => {
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
    workspace.writeText("painter.js", `${PAINTER}\n`);
    const opened = await request.post("/api/terminals", {
      data: { storageId: workspace.firstStorageId, path: workspace.name },
    });
    terminalId = (await readJson<{ terminal: { id: string } }>(opened)).terminal.id;

    let socketCount = 0;
    page.on("websocket", (socket) => {
      if (socket.url().includes("/api/terminals/")) socketCount += 1;
    });
    await page.goto(workspace.url());
    await waitForPageReady(page);
    const panel = page.locator(`[data-terminal-id="${terminalId}"]`);
    const screen = panel.locator(".xterm-rows");
    await expect(screen).not.toBeEmpty({ timeout: 30_000 });
    await panel.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("node painter.js heavy\n");
    await expect(screen).toContainText("static line 7 keep-me", { timeout: 15_000 });

    await panel.getByRole("button", { name: "Minimize" }).click();
    await expect(panel).toHaveAttribute("data-collapsed", "true");
    await page.waitForTimeout(2000);
    await panel.getByRole("button", { name: "Open" }).click();
    await expect(panel).toHaveAttribute("data-collapsed", "false");
    await page.waitForTimeout(500);

    for (let line = 0; line < 8; line += 1) await expect(screen).toContainText(`static line ${line} keep-me`);
    await expect(screen).toContainText(/status \(\ds\) tokens/);
    expect(socketCount, "minimizing and opening keeps the same connection").toBe(1);

    // A reload attaches anew: the server's copy of the screen must be whole, not a tail of repaints.
    await page.reload();
    await expect(screen).toContainText("static line 0 keep-me", { timeout: 15_000 });
    for (let line = 1; line < 8; line += 1) await expect(screen).toContainText(`static line ${line} keep-me`);
  } finally {
    if (terminalId) await request.delete(`/api/terminals/${terminalId}`);
    await request.put("/api/settings/terminal.enabled", { data: { value: false } });
  }
});
