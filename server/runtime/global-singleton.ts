import "server-only";

/**
 * Returns the one process-wide instance named `singletonName`, creating it on first use.
 *
 * The entry bundle and Next's server chunks each get their own copy of every `server/*` module,
 * but they run in one process. Keeping shared state (database handle, event bus, keyring) on
 * `globalThis` under a `Symbol.for` key makes both copies see the same instance.
 *
 * `isUsable` checks the stored instance's shape (not `instanceof`: each copy has its own classes).
 * In development, Next's hot reload keeps `globalThis`, so an instance of an older class version is
 * replaced instead of failing on a missing method.
 */
export function getGlobalSingleton<Value>(
  singletonName: string,
  createValue: () => Value,
  isUsable: (storedValue: unknown) => boolean = () => true,
): Value {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  const registryKey = Symbol.for(`cmm.${singletonName}`);
  if (!(registryKey in registry) || !isUsable(registry[registryKey])) registry[registryKey] = createValue();
  return registry[registryKey] as Value;
}

/** Forgets the instance named `singletonName`, so the next `getGlobalSingleton` call creates a new one. */
export function clearGlobalSingleton(singletonName: string): void {
  const registry = globalThis as unknown as Record<symbol, unknown>;
  delete registry[Symbol.for(`cmm.${singletonName}`)];
}
