import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { findPasswordPolicyProblem, usernameSchema } from "@/lib/auth/policy";
import { hashPassword } from "@/server/auth/password";
import { generateSetupCode, SETUP_CODE_FILE_NAME } from "@/server/auth/setup-code";
import { getConfig } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ApiRouteError, conflict, validationFailed } from "@/server/http/api-error";
import { getRateLimiter } from "@/server/security/rate-limit";
import { setSetting } from "@/server/settings/store";

export function getSetupCodePath(): string {
  return path.join(getConfig().dataDir, SETUP_CODE_FILE_NAME);
}

/** Setup is complete once an admin exists. */
export function isSetupComplete(): boolean {
  const adminRow = getDatabase().orm.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1).get();
  return adminRow !== undefined;
}

/** Only server mode asks for the one-time setup code; on the desktop, the person at the machine is the owner. */
export function needsSetupCode(): boolean {
  return getConfig().mode === "server" && !isSetupComplete();
}

function normalizeSetupCode(setupCode: string): string {
  return setupCode.trim().toUpperCase().replaceAll(/[\s-]/g, "");
}

/**
 * In server mode before setup, makes sure `<dataDir>/setup-code` exists. A new code is printed to
 * stdout (journald) so the person installing CCM can read it; `install.sh` normally creates it first.
 */
export function ensureSetupCode(): void {
  if (!needsSetupCode()) return;
  const setupCodePath = getSetupCodePath();
  if (existsSync(setupCodePath)) {
    console.log(`[ccm] first-run setup: the setup code is in ${setupCodePath}`);
    return;
  }
  const setupCode = generateSetupCode();
  writeFileSync(setupCodePath, `${setupCode}\n`, { mode: 0o600 });
  console.log(`[ccm] first-run setup code: ${setupCode} (also saved in ${setupCodePath})`);
}

function assertSetupCodeMatches(givenSetupCode: string | undefined, clientIp: string): void {
  const rateLimiter = getRateLimiter("setup-code");
  rateLimiter.assertAllowed(clientIp);
  const setupCodePath = getSetupCodePath();
  const expectedSetupCode = existsSync(setupCodePath) ? readFileSync(setupCodePath, "utf8") : "";
  const digest = (setupCode: string) => createHash("sha256").update(normalizeSetupCode(setupCode)).digest();
  const isMatch =
    expectedSetupCode.trim() !== "" && timingSafeEqual(digest(givenSetupCode ?? ""), digest(expectedSetupCode));
  if (!isMatch) {
    throw rateLimiter.rejectAttempt(
      clientIp,
      new ApiRouteError(
        403,
        "SETUP_CODE_INVALID",
        "The setup code is wrong. It is in the setup-code file in the data directory.",
      ),
    );
  }
  rateLimiter.reset(clientIp);
}

export interface InitialAdminRequest {
  username: string;
  password: string;
  setupCode?: string;
  autoLockMinutes?: number;
  ip?: string;
}

/**
 * Creates the first admin. The admin check and the insert run in one immediate transaction, so two
 * concurrent setups can't both succeed. In server mode the setup code must match and its file is
 * deleted afterwards.
 */
export async function createInitialAdmin({
  username,
  password,
  setupCode,
  autoLockMinutes,
  ip: clientIp = "",
}: InitialAdminRequest): Promise<{ id: string; username: string }> {
  if (isSetupComplete()) throw conflict("SETUP_COMPLETE", "CCM is already set up.");
  const isServerMode = getConfig().mode === "server";
  if (isServerMode) assertSetupCodeMatches(setupCode, clientIp);

  const parsedUsername = usernameSchema.safeParse(username);
  if (!parsedUsername.success) throw validationFailed(parsedUsername.error.issues[0]?.message ?? "Invalid username.");
  const policyProblem = findPasswordPolicyProblem(parsedUsername.data, password);
  if (policyProblem) throw validationFailed(policyProblem);

  const passwordHash = await hashPassword(password);
  const { connection, orm } = getDatabase();
  const adminId = randomUUID();
  const insertAdmin = connection.transaction(() => {
    const existingAdmin = orm.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1).get();
    if (existingAdmin) throw conflict("SETUP_COMPLETE", "CCM is already set up.");
    orm.insert(users).values({ id: adminId, username: parsedUsername.data, passwordHash, role: "admin" }).run();
  });
  insertAdmin.immediate();

  if (autoLockMinutes !== undefined) setSetting("security.autoLockMinutes", autoLockMinutes);
  if (isServerMode) rmSync(getSetupCodePath(), { force: true });
  return { id: adminId, username: parsedUsername.data };
}
