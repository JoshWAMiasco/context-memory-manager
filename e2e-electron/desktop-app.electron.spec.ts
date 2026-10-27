import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import NodeWebSocket from "ws";
import { encryptFolder, lockFolder } from "../e2e/support/crypto";
import { ADMIN_PASSWORD } from "../e2e/support/environment";
import { HOME, HOME_STORAGE_ID, expect, openRowMenu, test, treeRow } from "./fixtures";

const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

test.describe.configure({ mode: "serial" });

test("the real app starts in desktop mode on scratch data, with the real desktop bridge", async ({ desktop }) => {
  const { electronApp, page } = desktop;
  expect(await electronApp.evaluate(({ app }) => app.getVersion())).toBe(version);
  expect(await electronApp.evaluate(({ app }) => app.getPath("userData"))).toBe(desktop.userData);

  const bridge = await page.evaluate(() => ({
    isDesktop: window.cmmDesktop?.isDesktop,
    platform: window.cmmDesktop?.platform,
    appVersion: window.cmmDesktop?.appVersion,
  }));
  expect(bridge).toEqual({ isDesktop: true, platform: process.platform, appVersion: version });

  const health = await page.evaluate(async () => (await fetch("/api/health")).json());
  expect(health).toMatchObject({ ok: true, version, mode: "desktop" });

  await page.goto(`${desktop.origin}/`);
  await expect(page.getByTestId("app-version")).toHaveText(`CMM ${version}`);
  await expect(page.getByTestId("drives-dashboard").getByText("Home", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(1280);
});

test("the bridge refuses to reveal or open paths that are gone, without opening Finder", async ({ desktop }) => {
  const missing = path.join(HOME, "does-not-exist");
  const results = await desktop.page.evaluate(async (target) => {
    const bridge = window.cmmDesktop;
    return [await bridge?.revealPath(target), await bridge?.openFolder(target)];
  }, missing);
  expect(results).toEqual([false, false]);
});

test("Copy full path puts the absolute path on the system clipboard", async ({ desktop, workspace }) => {
  const { page, electronApp } = desktop;
  workspace.writeText("docs/note.txt", "hello\n");
  await page.goto(workspace.url(desktop, "docs", "note.txt"));

  const fileMenu = await openRowMenu(page, workspace.path("docs", "note.txt"));
  await expect(fileMenu.getByTestId("menu-reveal")).toHaveAttribute("aria-disabled", "false");
  await fileMenu.getByTestId("menu-copy-path").click();
  await expect(page.getByText("Copied", { exact: true })).toBeVisible();
  const fileCopy = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
  expect(realpathSync(fileCopy)).toBe(realpathSync(workspace.disk("docs", "note.txt")));
  expect(realpathSync(fileCopy).startsWith(realpathSync(HOME))).toBe(true);

  const folderMenu = await openRowMenu(page, workspace.path("docs"));
  await folderMenu.getByTestId("menu-copy-path").click();
  await expect
    .poll(async () => realpathSync(await electronApp.evaluate(({ clipboard }) => clipboard.readText())))
    .toBe(realpathSync(workspace.disk("docs")));
});

test("Move to… moves a file through the picker", async ({ desktop, workspace }) => {
  const { page } = desktop;
  workspace.writeText("a.txt", "alpha\n");
  workspace.makeFolder("docs");
  await page.goto(workspace.url(desktop, "a.txt"));
  const menu = await openRowMenu(page, workspace.path("a.txt"));
  await menu.getByTestId("menu-move").click();
  const dialog = page.getByTestId("move-dialog");
  await expect(dialog.getByTestId("move-confirm")).toBeDisabled();
  await dialog.getByTestId("move-folder-picker").getByRole("option", { name: "docs" }).click();
  await dialog.getByTestId("move-confirm").click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => existsSync(workspace.disk("docs", "a.txt"))).toBe(true);
  expect(existsSync(workspace.disk("a.txt"))).toBe(false);
  await expect(treeRow(page, workspace.path("a.txt"))).toHaveCount(0);
});

test("a memory card converts to a normal folder from the dashboard", async ({ desktop, workspace }) => {
  const { page, api } = desktop;
  const memoryName = `Persona ${workspace.name}`;
  const created = await api.post("/api/memory", {
    data: { storageId: HOME_STORAGE_ID, parentPath: workspace.name, folderName: "persona", name: memoryName },
  });
  expect(created.ok()).toBe(true);
  workspace.writeText("persona/notes.md", "# keep\n");

  await page.goto(`${desktop.origin}/`);
  const card = page.getByTestId(`memory-card-${HOME_STORAGE_ID}-${workspace.path("persona")}`);
  await expect(card).toBeVisible();
  await card.click({ button: "right" });
  await page.getByTestId("menu-convert-folder").click();
  await page.getByTestId("convert-folder-dialog").getByRole("button", { name: "Convert to normal folder" }).click();
  await expect(card).toHaveCount(0);
  expect(readFileSync(workspace.disk("persona", "notes.md"), "utf8")).toBe("# keep\n");
});

test("a deep path folds to Back in the window, and Back goes up a level", async ({ desktop, workspace }) => {
  const { page } = desktop;
  const folders = ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8"];
  workspace.writeText(`${folders.join("/")}/note.md`, "# deep\n");
  await page.goto(workspace.url(desktop, ...folders, "note.md"));
  const trail = page.getByTestId("breadcrumb");
  await expect(trail).toHaveAttribute("data-collapsed", "true");
  const overflow = await trail.evaluate((element) => ({ scroll: element.scrollWidth, client: element.clientWidth }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
  const back = page.getByTestId("breadcrumb-back");
  await expect(back).toHaveAccessibleName("Back to l8");
  await back.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("breadcrumb-current")).toHaveText("l8");
});

test("the terminal socket needs the launch cookie and a session; a shell runs for the app", async ({
  desktop,
  workspace,
}) => {
  const { page, api, port } = desktop;
  const listing = (await (await api.get("/api/terminals")).json()) as {
    available: boolean;
    unavailableReason?: string;
  };
  test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");
  const opened = await api.post("/api/terminals", {
    data: { storageId: HOME_STORAGE_ID, path: workspace.name, cols: 100, rows: 30 },
  });
  expect(opened.status()).toBe(201);
  const terminalId = ((await opened.json()) as { terminal: { id: string } }).terminal.id;
  const url = `ws://127.0.0.1:${port}/api/terminals/${terminalId}/socket`;
  const origin = `http://127.0.0.1:${port}`;

  const refusal = (headers: Record<string, string>) =>
    new Promise<number | undefined>((resolve, reject) => {
      const socket = new NodeWebSocket(url, { headers });
      socket.on("open", () => {
        socket.close();
        resolve(undefined);
      });
      socket.on("unexpected-response", (request, response) => {
        request.destroy();
        resolve(response.statusCode);
      });
      socket.on("error", reject);
    });
  const launchCookie = desktop.cookieHeader.split("; ").filter((pair) => pair.startsWith("cmm_launch="));
  const sessionCookie = desktop.cookieHeader.split("; ").filter((pair) => pair.startsWith("cmm_session="));
  expect(launchCookie).toHaveLength(1);
  expect(sessionCookie).toHaveLength(1);
  expect(await refusal({ origin }), "no cookies").toBe(403);
  expect(await refusal({ origin, cookie: sessionCookie.join("; ") }), "session but no launch cookie").toBe(403);
  expect(await refusal({ origin, cookie: launchCookie.join("; ") }), "launch cookie but no session").toBe(401);
  expect(await refusal({ cookie: desktop.cookieHeader }), "no Origin").toBe(403);
  expect(await refusal({ cookie: desktop.cookieHeader, origin: "http://evil.example" }), "foreign origin").toBe(403);

  /* The app's own window connects (cookies and origin come with the page) and gets a working shell. */
  const output = await page.evaluate(
    ([target]) =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(target ?? "");
        let text = "";
        const timer = setTimeout(() => reject(new Error(`no output: ${text.slice(-200)}`)), 40_000);
        socket.onopen = () => socket.send(JSON.stringify({ type: "input", data: "echo e2e-$((6*7))\r" }));
        socket.onerror = () => reject(new Error("socket error"));
        socket.onmessage = (event) => {
          const message = JSON.parse(String(event.data)) as { type: string; data?: string };
          if (message.type === "output") text += message.data ?? "";
          if (text.includes("e2e-42")) {
            clearTimeout(timer);
            socket.close();
            resolve(text);
          }
        };
      }),
    [url],
  );
  expect(output).toContain("e2e-42");
  await api.delete(`/api/terminals/${terminalId}`);
});

test("a passphrase-protected key file unlocks a folder in the app, asking for the passphrase once", async ({
  desktop,
  workspace,
}) => {
  const { page, api } = desktop;
  const passphrase = "correct horse battery staple";
  workspace.writeText("vault/secret.txt", "top secret plaintext");
  const { keyFile, recoveryKeyFile } = await encryptFolder(api, HOME_STORAGE_ID, workspace.path("vault"), passphrase);
  expect(JSON.parse(keyFile.toString("utf8"))).toMatchObject({ v: 2 });
  expect(JSON.parse((recoveryKeyFile ?? Buffer.alloc(0)).toString("utf8"))).toMatchObject({ v: 1 });
  const header = readFileSync(workspace.disk("vault", "secret.txt")).subarray(0, 4).toString("ascii");
  expect(header).toBe("CCM1");

  await lockFolder(api, HOME_STORAGE_ID, workspace.path("vault"));
  await page.goto(workspace.url(desktop, "vault", "secret.txt"));
  const panel = page.getByTestId("unlock-panel");
  await expect(panel).toBeVisible();
  await panel.getByTestId("unlock-keyfile-dropzone-input").setInputFiles({
    name: "vault.cmmkey",
    mimeType: "application/json",
    buffer: keyFile,
  });
  await expect(panel.getByTestId("unlock-keyfile-passphrase")).toBeVisible();
  await panel.locator("#unlock-password").fill(ADMIN_PASSWORD);
  await panel.getByTestId("unlock-keyfile-passphrase").locator("input").fill(passphrase);
  await panel.getByTestId("unlock-submit").click();
  await expect(panel).toBeHidden();
  await expect(page.getByText("top secret plaintext")).toBeVisible();
});
