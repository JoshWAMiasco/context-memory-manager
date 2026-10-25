import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, ne } from "drizzle-orm";
import type { UserSummary } from "@/lib/api-types";
import { findPasswordPolicyProblem, usernameSchema, type UserRole } from "@/lib/auth/policy";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { revokeUserSessions, type UserRow } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { ApiRouteError, conflict, notFound, validationFailed } from "@/server/http/api-error";

export function toUserSummary(user: UserRow): UserSummary {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  };
}

export function findUserById(userId: string): UserRow | undefined {
  return getDatabase().orm.select().from(users).where(eq(users.id, userId)).get();
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDatabase().orm.select().from(users).where(eq(users.username, username.trim().toLowerCase())).get();
}

export function listUsers(): UserSummary[] {
  return getDatabase().orm.select().from(users).orderBy(asc(users.username)).all().map(toUserSummary);
}

function requireUser(userId: string): UserRow {
  const user = findUserById(userId);
  if (!user) throw notFound("That user doesn't exist.");
  return user;
}

function parseUsername(username: string): string {
  const parsedUsername = usernameSchema.safeParse(username);
  if (!parsedUsername.success) throw validationFailed(parsedUsername.error.issues[0]?.message ?? "Invalid username.");
  return parsedUsername.data;
}

function assertPasswordPolicy(username: string, password: string): void {
  const policyProblem = findPasswordPolicyProblem(username, password);
  if (policyProblem) throw validationFailed(policyProblem, { field: "password" });
}

/** Throws `LAST_ADMIN` when `userId` is the only enabled admin left. */
function assertNotLastAdmin(userId: string): void {
  const otherAdminCount = getDatabase()
    .orm.select({ adminCount: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.disabled, false), ne(users.id, userId)))
    .get();
  if ((otherAdminCount?.adminCount ?? 0) === 0) throw conflict("LAST_ADMIN", "CCM needs at least one enabled admin.");
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role: UserRole;
}

/** Creates a user who must change the given password on first sign-in. */
export async function createUser({ username, password, role }: CreateUserRequest): Promise<UserSummary> {
  const parsedUsername = parseUsername(username);
  assertPasswordPolicy(parsedUsername, password);
  if (findUserByUsername(parsedUsername)) throw conflict("ALREADY_EXISTS", "That username is taken.");
  const passwordHash = await hashPassword(password);
  const createdUser = getDatabase()
    .orm.insert(users)
    .values({ id: randomUUID(), username: parsedUsername, passwordHash, role, mustChangePassword: true })
    .returning()
    .get();
  return toUserSummary(createdUser);
}

export interface UpdateUserRequest {
  role?: UserRole;
  disabled?: boolean;
}

/** Changes a user's role or disabled flag. The last enabled admin can't be demoted or disabled. */
export function updateUser(userId: string, { role, disabled }: UpdateUserRequest): UserSummary {
  const user = requireUser(userId);
  const isLosingAdmin =
    user.role === "admin" && !user.disabled && ((role !== undefined && role !== "admin") || disabled === true);
  if (isLosingAdmin) assertNotLastAdmin(userId);
  const updatedUser = getDatabase()
    .orm.update(users)
    .set({ ...(role === undefined ? {} : { role }), ...(disabled === undefined ? {} : { disabled }) })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (disabled === true) revokeUserSessions(userId);
  return toUserSummary(updatedUser);
}

/** Sets a temporary password the user must change at next sign-in, and signs them out everywhere. */
export async function resetUserPassword(userId: string, temporaryPassword: string): Promise<UserSummary> {
  const user = requireUser(userId);
  assertPasswordPolicy(user.username, temporaryPassword);
  const passwordHash = await hashPassword(temporaryPassword);
  const updatedUser = getDatabase()
    .orm.update(users)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(users.id, userId))
    .returning()
    .get();
  revokeUserSessions(userId);
  return toUserSummary(updatedUser);
}

export function deleteUser(userId: string): void {
  const user = requireUser(userId);
  if (user.role === "admin" && !user.disabled) assertNotLastAdmin(userId);
  getDatabase().orm.delete(users).where(eq(users.id, userId)).run();
}

/** Changes the signed-in user's own password and signs out their other sessions. */
export async function changeOwnPassword(
  user: UserRow,
  currentPassword: string,
  nextPassword: string,
  keptSessionIdHash: string,
): Promise<void> {
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ApiRouteError(401, "INVALID_CREDENTIALS", "The current password is wrong.");
  }
  assertPasswordPolicy(user.username, nextPassword);
  if (currentPassword === nextPassword)
    throw validationFailed("Choose a password different from the current one.", { field: "password" });
  const passwordHash = await hashPassword(nextPassword);
  getDatabase().orm.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id)).run();
  revokeUserSessions(user.id, keptSessionIdHash);
}

export function recordLogin(userId: string, now = Date.now()): void {
  getDatabase()
    .orm.update(users)
    .set({ lastLoginAt: new Date(now) })
    .where(eq(users.id, userId))
    .run();
}
