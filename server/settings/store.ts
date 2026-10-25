import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { STEP_UP_ACTIONS } from "@/lib/auth/policy";
import { getConfig } from "@/server/config";
import { getDatabase } from "@/server/db/client";
import { settings } from "@/server/db/schema";
import { readTestOverride } from "@/server/runtime/test-hooks";

/** The settings an admin can read and change through `/api/settings/[key]`, with their schemas and defaults. */
const SETTING_DEFINITIONS = {
  "security.autoLockMinutes": {
    schema: z.number().int().min(1).max(1440),
    readDefault: () => getConfig().autoLockMinutes,
  },
  "security.signInMaxAttempts": {
    schema: z.number().int().min(3).max(20),
    readDefault: () => 5,
  },
  "security.signInLockoutMinutes": {
    schema: z.number().int().min(1).max(1440),
    readDefault: () => 15,
  },
  "security.stepUpActions": {
    schema: z.array(z.enum(STEP_UP_ACTIONS)).transform((actions) => [...new Set(actions)]),
    readDefault: () => [...STEP_UP_ACTIONS],
  },
  "storage.newDrivesVisibleTo": {
    schema: z.enum(["admins", "all"]),
    readDefault: () => "admins" as const,
  },
  "trash.autoPurgeDays": {
    schema: z.number().int().min(0).max(3650),
    readDefault: () => 0,
  },
  "editor.maxEditBytes": {
    schema: z
      .number()
      .int()
      .min(1024 * 1024)
      .max(50 * 1024 * 1024),
    readDefault: () => 5 * 1024 * 1024,
  },
  "viewer.csvMaxRows": {
    schema: z.number().int().min(1000).max(1_000_000),
    readDefault: () => 50_000,
  },
  "protection.macosImmutable": {
    schema: z.boolean(),
    readDefault: () => false,
  },
  "encryption.unlockTtlMinutes": {
    schema: z.number().int().min(1).max(1440),
    readDefault: () => getConfig().unlockTtlMinutes,
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFINITIONS;
export type SettingValue<Key extends SettingKey> = z.output<(typeof SETTING_DEFINITIONS)[Key]["schema"]>;

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

/** Validates `value` against the setting's schema; throws a ZodError when it doesn't fit. */
export function parseSettingValue<Key extends SettingKey>(key: Key, value: unknown): SettingValue<Key> {
  return SETTING_DEFINITIONS[key].schema.parse(value) as SettingValue<Key>;
}

/** The stored value, or the default when unset or no longer valid. */
export function getSetting<Key extends SettingKey>(key: Key): SettingValue<Key> {
  const storedRow = getDatabase().orm.select().from(settings).where(eq(settings.key, key)).get();
  if (storedRow) {
    const parsedValue = SETTING_DEFINITIONS[key].schema.safeParse(JSON.parse(storedRow.valueJson));
    if (parsedValue.success) return parsedValue.data as SettingValue<Key>;
  }
  return SETTING_DEFINITIONS[key].readDefault() as SettingValue<Key>;
}

/** Validates and stores a setting, returning the stored value. */
export function setSetting<Key extends SettingKey>(key: Key, value: unknown): SettingValue<Key> {
  const parsedValue = parseSettingValue(key, value);
  const valueJson = JSON.stringify(parsedValue);
  getDatabase()
    .orm.insert(settings)
    .values({ key, valueJson })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson } })
    .run();
  return parsedValue;
}

/** How long a session may stay idle before it locks. `CMM_TEST_AUTO_LOCK_SECONDS` overrides it in tests. */
export function getAutoLockSeconds(): number {
  const overrideSeconds = Number(readTestOverride("CMM_TEST_AUTO_LOCK_SECONDS"));
  if (Number.isInteger(overrideSeconds) && overrideSeconds > 0) return overrideSeconds;
  return getSetting("security.autoLockMinutes") * 60;
}

/**
 * How many wrong passwords in a row (per client address and username) lock sign-in, unlock and
 * step-up, and for how long. `CMM_TEST_SIGN_IN_LOCKOUT_SECONDS` shortens the lock in tests.
 */
export function getSignInLockoutPolicy(): { maximumAttempts: number; lockoutMilliseconds: number } {
  const overrideSeconds = Number(readTestOverride("CMM_TEST_SIGN_IN_LOCKOUT_SECONDS"));
  const lockoutSeconds =
    Number.isInteger(overrideSeconds) && overrideSeconds > 0
      ? overrideSeconds
      : getSetting("security.signInLockoutMinutes") * 60;
  return { maximumAttempts: getSetting("security.signInMaxAttempts"), lockoutMilliseconds: lockoutSeconds * 1000 };
}
