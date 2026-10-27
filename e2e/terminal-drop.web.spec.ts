import { readJson } from "./support/api";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, test, treeRow, waitForPageReady } from "./support/fixtures";

/*
 * Dropping on a terminal pastes paths at the prompt, without running anything: a tree row gives
 * its absolute path on the server; a file from the computer has none on a server, so it explains.
 */
test.describe("drop on a terminal", () => {
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

  test("a tree row pastes its quoted absolute path, and a file from the computer explains why it can't", async ({
    page,
    request,
    workspace,
  }) => {
    const listing = await readJson<{ available: boolean; unavailableReason?: string }>(
      await request.get("/api/terminals"),
    );
    test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");
    workspace.writeText("docs/my note.md", "hello\n");
    const opened = await request.post("/api/terminals", {
      data: { storageId: workspace.firstStorageId, path: workspace.name },
    });
    expect(opened.status()).toBe(201);
    terminalId = (await readJson<{ terminal: { id: string } }>(opened)).terminal.id;

    await page.goto(workspace.url("docs", "my note.md"));
    await waitForPageReady(page);
    const dropTarget = page.locator(`[data-terminal-id="${terminalId}"]`).getByTestId("terminal-drop-target");
    await expect(dropTarget).toBeVisible();
    const screen = dropTarget.locator(".xterm-rows");
    await expect(screen).not.toBeEmpty({ timeout: 30_000 });

    await treeRow(page, workspace.path("docs", "my note.md")).dragTo(dropTarget);
    const expected = `'${workspace.disk("docs", "my note.md")}'`;
    // xterm draws each row in its own element and pads with no-break spaces; compare without spacing.
    const squash = (text: string) => text.replaceAll(/[\s ]/g, "");
    await expect.poll(async () => squash((await screen.textContent()) ?? "")).toContain(squash(expected));

    // Nothing ran: the shell still waits on the same line, so the file wasn't opened or listed.
    await expect.poll(async () => (await screen.textContent()) ?? "").not.toContain("No such file");

    await dropTarget.evaluate((target) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["x"], "from-computer.txt", { type: "text/plain" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
      }
    });
    await expect(page.getByText("No path to paste")).toBeVisible();
    await expect(page.getByText(/have no path on the server/)).toBeVisible();
  });
});
