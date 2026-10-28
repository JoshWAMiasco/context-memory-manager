import { describe, expect, it, vi } from "vitest";
import type { TerminalServerMessage } from "@/lib/terminal";

vi.mock("@/server/settings/store", () => ({ getSetting: () => true }));
vi.mock("@/server/meta/effective", () => ({ readManifest: vi.fn() }));
vi.mock("@/server/config", () => ({ getConfig: () => ({ dataDir: "/nonexistent" }) }));

const { attachToTerminal } = await import("@/server/terminal");

type Session = Parameters<typeof attachToTerminal>[0];
type Listener = (message: TerminalServerMessage, sequence?: number) => void;

/** A terminal whose host answers the snapshot request when the test calls `answer`. */
function createSession(snapshot: { sequence: number; data: string }) {
  let answerSnapshot: (() => void) | undefined;
  const session = {
    summary: { id: "term-1", status: "running" },
    listeners: new Set<Listener>(),
    host: {
      snapshot: vi.fn(
        () =>
          new Promise<{ sequence: number; data: string }>((resolve) => {
            answerSnapshot = () => resolve(snapshot);
          }),
      ),
    },
  } as unknown as Session;
  return {
    session,
    /** An output the host sent, numbered as the host numbers them. */
    shellOutput(data: string, sequence: number) {
      for (const listener of session.listeners as Set<Listener>) listener({ type: "output", data }, sequence);
    },
    async answer() {
      answerSnapshot?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("attachToTerminal", () => {
  it("sends the host's screen first, then the outputs it does not show yet", async () => {
    const terminal = createSession({ sequence: 1, data: "before " });
    const received: TerminalServerMessage[] = [];
    attachToTerminal(terminal.session, (message) => received.push(message));
    terminal.shellOutput("during", 2);
    await terminal.answer();
    terminal.shellOutput(" after", 3);
    expect(received).toEqual([
      { type: "output", data: "before " },
      { type: "output", data: "during" },
      { type: "output", data: " after" },
    ]);
  });

  it("skips an output that reached CMM while attaching but is already on the screen", async () => {
    const terminal = createSession({ sequence: 2, data: "one two" });
    const received: TerminalServerMessage[] = [];
    attachToTerminal(terminal.session, (message) => received.push(message));
    terminal.shellOutput("two", 2);
    terminal.shellOutput(" three", 3);
    await terminal.answer();
    expect(received).toEqual([
      { type: "output", data: "one two" },
      { type: "output", data: " three" },
    ]);
  });

  it("stops sending once detached, and reports an ended shell", async () => {
    const terminal = createSession({ sequence: 0, data: "" });
    (terminal.session.summary as { status: string; exitCode?: number }).status = "exited";
    (terminal.session.summary as { exitCode?: number }).exitCode = 3;
    const received: TerminalServerMessage[] = [];
    const detach = attachToTerminal(terminal.session, (message) => received.push(message));
    await terminal.answer();
    expect(received).toEqual([{ type: "exit", exitCode: 3 }]);
    detach();
    terminal.shellOutput("late", 1);
    expect(received).toHaveLength(1);
  });
});
