import "server-only";
import { hash, verify } from "@node-rs/argon2";

export { findPasswordPolicyProblem, passwordPolicy } from "@/lib/auth/policy";

/** `Algorithm.Argon2id` in @node-rs/argon2, a const enum that can't be imported under isolatedModules. */
const ARGON2ID_ALGORITHM = 2;

/** argon2id with 64 MiB of memory, 3 passes and 1 lane. Changing these only affects new hashes. */
export const ARGON2_PARAMETERS = {
  algorithm: ARGON2ID_ALGORITHM,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_PARAMETERS);
}

/** True when `password` matches `passwordHash`. A malformed hash counts as a mismatch. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let timingDecoyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when the username doesn't exist, so response times don't
 * reveal which usernames are taken.
 */
export async function verifyAgainstDecoy(password: string): Promise<false> {
  timingDecoyHash ??= hashPassword("ccm-timing-decoy-password");
  await verifyPassword(await timingDecoyHash, password);
  return false;
}
