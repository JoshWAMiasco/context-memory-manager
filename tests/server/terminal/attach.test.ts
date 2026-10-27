import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { describe, expect, it, vi } from "vitest";
import type { TerminalServerMessage } from "@/lib/terminal";

vi.mock("@/server/settings/store", () => ({ getSetting: () => true }));
vi.mock("@/server/meta/effective", () => ({ readManifest: vi.fn() }));

const { attachToTerminal } = await import("@/server/terminal");

type Session = Parameters<typeof attachToTerminal>[0];

function createSession(): Session {
  const screen = new HeadlessTerminal({ cols: 40, rows: 8, scrollback: 50, allowProposedApi: true });
  const serializer = new SerializeAddon();
  screen.loadAddon(serializer as never);
  return {
    summary: { id: "term-1", status: "running" },
    listeners: new Set(),
    screen,
    serializer,
  } as unknown as Session;
}

/** What the shell's output does on the server: onto the screen, then to every panel. */
function shellOutput(session: Session, data: string): void {
  session.screen.write(data);
  for (const listener of session.listeners) listener({ type: "output", data });
}

function waitForScreen(session: Session): Promise<void> {
  return new Promise((resolve) => session.screen.write("", resolve));
}

describe("attachToTerminal", () => {
  it("sends the screen as it is, not a tail of repaints", async () => {
    const session = createSession();
    shellOutput(session, "\u001B[2J\u001B[Hheader line\r\nstatus 0");
    for (let tick = 0; tick < 5000; tick += 1) shellOutput(session, `\u001B[2;8H${tick % 10}`);
    const received: TerminalServerMessage[] = [];
    attachToTerminal(session, (message) => received.push(message));
    await waitForScreen(session);
    expect(received).toHaveLength(1);
    const copy = new HeadlessTerminal({ cols: 40, rows: 8, allowProposedApi: true });
    await new Promise<void>((resolve) => copy.write((received[0] as { data: string }).data, resolve));
    expect(copy.buffer.active.getLine(0)?.translateToString(true)).toBe("header line");
    expect(copy.buffer.active.getLine(1)?.translateToString(true)).toBe("status 9");
  });

  it("sends output that arrives while attaching after the screen, once", async () => {
    const session = createSession();
    shellOutput(session, "before ");
    const received: TerminalServerMessage[] = [];
    attachToTerminal(session, (message) => received.push(message));
    shellOutput(session, "during");
    await waitForScreen(session);
    shellOutput(session, " after");
    expect(received).toEqual([
      { type: "output", data: "before " },
      { type: "output", data: "during" },
      { type: "output", data: " after" },
    ]);
  });

  it("stops sending once detached, and reports an ended shell", async () => {
    const session = createSession();
    (session.summary as { status: string; exitCode?: number }).status = "exited";
    (session.summary as { exitCode?: number }).exitCode = 3;
    const received: TerminalServerMessage[] = [];
    const detach = attachToTerminal(session, (message) => received.push(message));
    await waitForScreen(session);
    expect(received).toEqual([{ type: "exit", exitCode: 3 }]);
    detach();
    shellOutput(session, "late");
    expect(received).toHaveLength(1);
  });
});
