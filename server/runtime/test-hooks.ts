import "server-only";

/**
 * Test overrides (`CCM_TEST_FORCE_NETWORK`, `CCM_TEST_AUTO_LOCK_SECONDS`) only apply under Vitest
 * (`NODE_ENV=test`) or when the e2e runner sets `CCM_TEST_HOOKS=1`. Installed services never set
 * either, so the overrides are inert in real deployments.
 */
export function areTestHooksEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.NODE_ENV === "test" || environment.CCM_TEST_HOOKS === "1";
}

/** Reads a test override, or undefined when test hooks are off or the variable is unset. */
export function readTestOverride(variableName: string): string | undefined {
  if (!areTestHooksEnabled()) return undefined;
  const overrideValue = process.env[variableName];
  return overrideValue === undefined || overrideValue === "" ? undefined : overrideValue;
}
