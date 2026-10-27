import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CmmDatabase } from "@/server/db/client";

const database: { current?: CmmDatabase } = {};

vi.mock("@/server/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db/client")>()),
  getDatabase: () => database.current,
}));
vi.mock("@/server/security/password-confirm", () => ({ requirePasswordConfirm: vi.fn(() => Promise.resolve()) }));
vi.mock("@/server/settings/store", () => ({ getSetting: () => ["upload", "download"] }));

const { openDatabase } = await import("@/server/db/client");
const { runMigrations } = await import("@/server/db/migrate");
const { sessions, users } = await import("@/server/db/schema");
const { confirmStepUp, consumeActionToken } = await import("@/server/security/step-up");
const { FOLDER_UPLOAD_GRANT_MILLISECONDS } = await import("@/lib/auth/policy");

const SESSION_ID = "session-hash-1";
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "cmm-step-up-"));

beforeAll(() => {
  database.current = openDatabase(path.join(temporaryDirectory, "cmm.db"));
  runMigrations(database.current.orm);
  database.current.orm
    .insert(users)
    .values({ id: "user-1", username: "alex", passwordHash: "x", role: "admin", createdAt: new Date() })
    .run();
  database.current.orm
    .insert(sessions)
    .values({
      idHash: SESSION_ID,
      userId: "user-1",
      createdAt: new Date(),
      lastActivityAt: new Date(),
      networkClass: "remote",
    })
    .run();
});

afterAll(() => {
  database.current?.connection.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function confirmRemote(resource: string, now: number): Promise<string> {
  const { actionToken } = await confirmStepUp(
    {
      resolvedSession: { session: { idHash: SESSION_ID }, user: { id: "user-1" } } as never,
      action: "upload",
      resource,
      networkClass: "remote",
      mode: "server",
      password: "secret",
      ip: "203.0.113.9",
    },
    now,
  );
  if (!actionToken) throw new Error("A remote confirmation should give an action token.");
  return actionToken;
}

describe("step-up tokens from a remote network", () => {
  it("are single use for one file", async () => {
    const now = Date.now();
    const token = await confirmRemote("home:notes/a.md", now);
    expect(consumeActionToken(SESSION_ID, "upload", "home:notes/a.md", token, now + 1)).toBe(true);
    expect(consumeActionToken(SESSION_ID, "upload", "home:notes/a.md", token, now + 2)).toBe(false);
  });

  it("cover a whole folder upload many times, only for that folder and action, until they expire", async () => {
    const now = Date.now();
    const token = await confirmRemote("home:import/**", now);
    for (let fileIndex = 0; fileIndex < 5; fileIndex += 1) {
      expect(consumeActionToken(SESSION_ID, "upload", "home:import/**", token, now + fileIndex)).toBe(true);
    }
    expect(consumeActionToken(SESSION_ID, "upload", "home:other/**", token, now)).toBe(false);
    expect(consumeActionToken(SESSION_ID, "upload", "home:import/a.md", token, now)).toBe(false);
    expect(consumeActionToken(SESSION_ID, "download", "home:import/**", token, now)).toBe(false);
    expect(consumeActionToken("another-session", "upload", "home:import/**", token, now)).toBe(false);
    expect(
      consumeActionToken(SESSION_ID, "upload", "home:import/**", token, now + FOLDER_UPLOAD_GRANT_MILLISECONDS + 1),
    ).toBe(false);
  });
});
