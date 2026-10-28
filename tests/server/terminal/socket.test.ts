import type http from "node:http";
import type { Duplex } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CmmConfig } from "@/server/config";

const handleUpgrade = vi.fn();
const resolveSession = vi.fn();
const readTerminalAvailability = vi.fn();
const requireTerminal = vi.fn();

vi.mock("ws", () => ({
  WebSocketServer: class {
    clients = new Set();
    handleUpgrade = handleUpgrade;
  },
}));
vi.mock("@/server/auth/session", () => ({
  SESSION_COOKIE_NAME: "cmm_session",
  resolveSession,
  touchActivity: vi.fn(),
}));
vi.mock("@/server/config", () => ({ getConfig: () => serverConfig }));
vi.mock("@/server/events/bus", () => ({ getEventBus: () => ({ on: vi.fn(), emit: vi.fn(), off: vi.fn() }) }));
vi.mock("@/server/terminal", () => ({
  attachToTerminal: vi.fn(() => () => undefined),
  readTerminalAvailability,
  readTerminalsPending: () => undefined,
  requireTerminal,
  resizeTerminal: vi.fn(),
  writeToTerminal: vi.fn(),
}));

const { handleTerminalUpgrade, isTerminalSocketRequest } = await import("@/server/terminal/socket");

const serverConfig = { mode: "server", trustedProxies: [] } as unknown as CmmConfig;
const desktopConfig = { mode: "desktop", trustedProxies: [] } as unknown as CmmConfig;
const LAUNCH_TOKEN = "launch-token-for-this-run";

function buildRequest(headers: Record<string, string>, url = "/api/terminals/term-1/socket"): http.IncomingMessage {
  return { url, headers: { host: "127.0.0.1:7420", ...headers } } as unknown as http.IncomingMessage;
}

function upgrade(
  request: http.IncomingMessage,
  { config = serverConfig, expectedLaunchToken }: { config?: CmmConfig; expectedLaunchToken?: string } = {},
): { status: number | undefined; socket: Duplex } {
  const end = vi.fn();
  const socket = { end } as unknown as Duplex;
  handleTerminalUpgrade(request, socket, Buffer.alloc(0), { config, expectedLaunchToken });
  const response = end.mock.calls[0]?.[0] as string | undefined;
  const status = response ? Number(/^HTTP\/1\.1 (\d{3})/.exec(response)?.[1]) : undefined;
  return { status, socket };
}

const signedInSession = {
  isLocked: false,
  user: { id: "user-1", role: "admin", mustChangePassword: false },
  session: { idHash: "hash-1" },
};

describe("handleTerminalUpgrade", () => {
  beforeEach(() => {
    resolveSession.mockReturnValue(signedInSession);
    readTerminalAvailability.mockReturnValue({ available: true });
    requireTerminal.mockReturnValue({ summary: { id: "term-1", status: "running" } });
  });

  it("only claims terminal socket paths", () => {
    expect(isTerminalSocketRequest(buildRequest({}))).toBe(true);
    expect(isTerminalSocketRequest(buildRequest({}, "/_next/webpack-hmr"))).toBe(false);
    expect(upgrade(buildRequest({ origin: "http://127.0.0.1:7420" }, "/api/other")).status).toBe(404);
    expect(handleUpgrade).not.toHaveBeenCalled();
  });

  it("refuses a desktop upgrade without the launch cookie, before reading the session", () => {
    const request = buildRequest({ origin: "http://127.0.0.1:7420", cookie: "cmm_session=abc" });
    expect(upgrade(request, { config: desktopConfig, expectedLaunchToken: LAUNCH_TOKEN }).status).toBe(403);
    const wrongToken = buildRequest({
      origin: "http://127.0.0.1:7420",
      cookie: `cmm_session=abc; cmm_launch=${LAUNCH_TOKEN}x`,
    });
    expect(upgrade(wrongToken, { config: desktopConfig, expectedLaunchToken: LAUNCH_TOKEN }).status).toBe(403);
    expect(resolveSession).not.toHaveBeenCalled();
    expect(handleUpgrade).not.toHaveBeenCalled();
  });

  it("refuses an upgrade without an Origin header or from another origin", () => {
    expect(upgrade(buildRequest({ cookie: "cmm_session=abc" })).status).toBe(403);
    expect(upgrade(buildRequest({ cookie: "cmm_session=abc", origin: "http://evil.example" })).status).toBe(403);
    expect(resolveSession).not.toHaveBeenCalled();
    expect(handleUpgrade).not.toHaveBeenCalled();
  });

  it("refuses an upgrade without a session, with a locked session or a pending password change", () => {
    const request = buildRequest({ origin: "http://127.0.0.1:7420", cookie: "cmm_session=abc" });
    resolveSession.mockReturnValue(undefined);
    expect(upgrade(request).status).toBe(401);
    resolveSession.mockReturnValue({ ...signedInSession, isLocked: true });
    expect(upgrade(request).status).toBe(401);
    resolveSession.mockReturnValue({ ...signedInSession, user: { ...signedInSession.user, mustChangePassword: true } });
    expect(upgrade(request).status).toBe(401);
    expect(resolveSession).toHaveBeenLastCalledWith("abc");
    expect(handleUpgrade).not.toHaveBeenCalled();
  });

  it("refuses users without terminals and terminals they did not open", () => {
    const request = buildRequest({ origin: "http://127.0.0.1:7420", cookie: "cmm_session=abc" });
    readTerminalAvailability.mockReturnValue({ available: false, code: "ROLE" });
    expect(upgrade(request).status).toBe(403);
    readTerminalAvailability.mockReturnValue({ available: true });
    requireTerminal.mockImplementation(() => {
      throw new Error("not yours");
    });
    expect(upgrade(request).status).toBe(404);
    expect(handleUpgrade).not.toHaveBeenCalled();
  });

  it("upgrades a same-origin, signed-in request for the user's own terminal", () => {
    const request = buildRequest({ origin: "http://127.0.0.1:7420", cookie: "cmm_session=abc" });
    expect(upgrade(request).status).toBeUndefined();
    expect(handleUpgrade).toHaveBeenCalledTimes(1);
    expect(requireTerminal).toHaveBeenCalledWith(signedInSession.user, "term-1");
  });

  it("upgrades a desktop request that carries this launch's cookie", () => {
    const request = buildRequest({
      origin: "http://127.0.0.1:7420",
      cookie: `cmm_launch=${LAUNCH_TOKEN}; cmm_session=abc`,
    });
    expect(upgrade(request, { config: desktopConfig, expectedLaunchToken: LAUNCH_TOKEN }).status).toBeUndefined();
    expect(handleUpgrade).toHaveBeenCalledTimes(1);
  });
});
