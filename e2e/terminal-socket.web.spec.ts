import type { ClientRequest, IncomingMessage } from "node:http";
import type { APIRequestContext } from "@playwright/test";
import WebSocket from "ws";
import { readJson } from "./support/api";
import { ADMIN_PASSWORD, ADMIN_USERNAME, WEB } from "./support/environment";
import { expect, test } from "./support/fixtures";

const SOCKET_BASE = WEB.baseUrl.replace("http", "ws");
const LOCKED_CLOSE_CODE = 4001;

interface UpgradeResult {
  /** The HTTP status of a refused upgrade. */
  status?: number;
  /** The open socket of an accepted one. */
  socket?: WebSocket;
}

/** Tries a WebSocket upgrade and reports whether it was refused (with which status) or accepted. */
function tryUpgrade(terminalId: string, headers: Record<string, string>): Promise<UpgradeResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${SOCKET_BASE}/api/terminals/${terminalId}/socket`, { headers });
    socket.on("open", () => resolve({ socket }));
    socket.on("unexpected-response", (request: ClientRequest, response: IncomingMessage) => {
      request.destroy();
      resolve({ status: response.statusCode });
    });
    socket.on("error", reject);
  });
}

async function readCookieHeader(request: APIRequestContext): Promise<string> {
  const { cookies } = await request.storageState();
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

test.describe("terminal WebSocket", () => {
  test("refuses an upgrade without a session, without an origin, and from another origin", async ({ request }) => {
    const cookie = await readCookieHeader(request);
    expect(cookie).toContain("cmm_session=");

    expect((await tryUpgrade("any-terminal", { origin: WEB.baseUrl })).status, "no session").toBe(401);
    expect((await tryUpgrade("any-terminal", { cookie })).status, "no Origin header").toBe(403);
    expect((await tryUpgrade("any-terminal", { cookie, origin: "http://evil.example" })).status, "foreign origin").toBe(
      403,
    );
    expect(
      (await tryUpgrade("any-terminal", { cookie, origin: "http://127.0.0.1:1" })).status,
      "same host, another port",
    ).toBe(403);
  });

  test("refuses a signed-in, same-origin upgrade while terminals are off on a server", async ({ request }) => {
    const setting = await readJson<{ value: boolean }>(await request.get("/api/settings/terminal.enabled"));
    expect(setting.value).toBe(false);
    const cookie = await readCookieHeader(request);
    expect((await tryUpgrade("any-terminal", { cookie, origin: WEB.baseUrl })).status).toBe(403);
  });

  test("runs a shell over the socket for the owner, and closes it when the session locks", async ({
    playwright,
    request,
    workspace,
  }) => {
    const enable = await request.put("/api/settings/terminal.enabled", {
      data: { value: true, password: ADMIN_PASSWORD },
    });
    expect(enable.ok()).toBe(true);
    let terminalId: string | undefined;
    const lockedSession = await playwright.request.newContext({ baseURL: WEB.baseUrl });
    try {
      const listing = await readJson<{ available: boolean; unavailableReason?: string }>(
        await request.get("/api/terminals"),
      );
      test.skip(!listing.available, listing.unavailableReason ?? "terminals are unavailable here");

      const opened = await request.post("/api/terminals", {
        data: { storageId: workspace.firstStorageId, path: workspace.name, cols: 100, rows: 30 },
      });
      expect(opened.status()).toBe(201);
      terminalId = (await readJson<{ terminal: { id: string } }>(opened)).terminal.id;

      const cookie = await readCookieHeader(request);
      const { socket, status } = await tryUpgrade(terminalId, { cookie, origin: WEB.baseUrl });
      expect(status).toBeUndefined();
      expect(socket).toBeDefined();
      if (!socket) return;
      let output = "";
      socket.on("message", (data) => {
        const message = JSON.parse(String(data)) as { type: string; data?: string };
        if (message.type === "output") output += message.data ?? "";
      });
      socket.send(JSON.stringify({ type: "resize", cols: 90, rows: 24 }));
      /* The arithmetic and the cwd's name length only appear in the output, not in the echoed command. */
      socket.send(JSON.stringify({ type: "input", data: 'echo e2e-$((6*7)); echo cwd-$(basename "$PWD" | wc -c)\r' }));
      await expect.poll(() => output, { timeout: 45_000 }).toContain("e2e-42");
      await expect.poll(() => output).toMatch(new RegExp(`cwd-\\s*${workspace.name.length + 1}\\b`));
      socket.close();

      /* A second socket on its own session closes with the locked code when that session locks. */
      const login = await lockedSession.post("/api/auth/login", {
        data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
      });
      expect(login.ok()).toBe(true);
      const second = await tryUpgrade(terminalId, {
        cookie: await readCookieHeader(lockedSession),
        origin: WEB.baseUrl,
      });
      expect(second.socket).toBeDefined();
      const closed = new Promise<number>((resolve) => second.socket?.on("close", (code) => resolve(code)));
      expect((await lockedSession.post("/api/auth/lock")).ok()).toBe(true);
      expect(await closed).toBe(LOCKED_CLOSE_CODE);

      /* The locked session can't open a new socket either. */
      const afterLock = await tryUpgrade(terminalId, {
        cookie: await readCookieHeader(lockedSession),
        origin: WEB.baseUrl,
      });
      expect(afterLock.status).toBe(401);
    } finally {
      if (terminalId) await request.delete(`/api/terminals/${terminalId}`);
      await lockedSession.dispose();
      await request.put("/api/settings/terminal.enabled", { data: { value: false } });
    }
  });
});
