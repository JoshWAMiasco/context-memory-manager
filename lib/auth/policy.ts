/*
 * Auth rules shared by the server and the browser: roles, step-up actions, and the username and
 * password policy. Isomorphic: no server-only imports here.
 */
import { z } from "zod";

export const USER_ROLES = ["admin", "editor", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const STEP_UP_ACTIONS = ["upload", "download", "delete-permanent", "user-admin", "storage-admin"] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

export const STEP_UP_ACTION_LABELS: Record<StepUpAction, string> = {
  upload: "Upload files",
  download: "Download files",
  "delete-permanent": "Delete permanently",
  "user-admin": "Manage users",
  "storage-admin": "Manage storages",
};

/** `lan-once`: confirm once per session (loopback or local network). `per-action`: confirm every action (remote). */
export type StepUpMode = "lan-once" | "per-action";

export const PASSWORD_MINIMUM_LENGTH = 10;
export const PASSWORD_MAXIMUM_LENGTH = 1024;

/** Usernames are case-insensitive: they are trimmed and stored in lower case. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Use at least 3 characters")
  .max(32, "Use at most 32 characters")
  .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, digits, dots, dashes or underscores")
  .transform((username) => username.toLowerCase());

export const passwordSchema = z
  .string()
  .min(PASSWORD_MINIMUM_LENGTH, `Use at least ${PASSWORD_MINIMUM_LENGTH} characters`)
  .max(PASSWORD_MAXIMUM_LENGTH, "This password is too long");

/** Returns why `password` breaks the policy for `username`, or undefined when it is acceptable. */
export function findPasswordPolicyProblem(username: string, password: string): string | undefined {
  const lengthCheck = passwordSchema.safeParse(password);
  if (!lengthCheck.success) return lengthCheck.error.issues[0]?.message;
  if (password.trim().toLowerCase() === username.trim().toLowerCase()) return "The password can't be the username";
  return undefined;
}

/** The password policy as a schema over `{ username, password }`: at least 10 characters and not the username. */
export const passwordPolicy = z
  .object({ username: z.string(), password: z.string() })
  .superRefine(({ username, password }, refinementContext) => {
    const policyProblem = findPasswordPolicyProblem(username, password);
    if (policyProblem) refinementContext.addIssue({ code: "custom", path: ["password"], message: policyProblem });
  });

/**
 * Scores a password from 0 to 4 for the strength meter: one point each for meeting the minimum
 * length, mixed case, a digit and a symbol.
 */
export function measurePasswordStrength(password: string): number {
  return [
    password.length >= PASSWORD_MINIMUM_LENGTH,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}
