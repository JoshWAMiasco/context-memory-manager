/*
 * Runs before `npm run dev`. A production build (`next build`) rewrites `.next/` while Turbopack's
 * dev cache lives in `.next/dev/`; after a build that cache can be inconsistent, which showed up as
 * a dev server serving an old stylesheet and as an endless "restart" reload loop in the browser.
 * When a build is newer than the dev cache, the dev cache is removed (the next start is a little
 * slower). Otherwise it is kept.
 */
import { rmSync, statSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");
const buildIdPath = path.join(projectRoot, ".next", "BUILD_ID");
const devCachePath = path.join(projectRoot, ".next", "dev");

function readModifiedTime(targetPath: string): number | undefined {
  try {
    return statSync(targetPath).mtimeMs;
  } catch {
    return undefined;
  }
}

const builtAt = readModifiedTime(buildIdPath);
const devCacheAt = readModifiedTime(devCachePath);
if (builtAt !== undefined && devCacheAt !== undefined && builtAt > devCacheAt) {
  rmSync(devCachePath, { recursive: true, force: true });
  console.log("[clear-stale-dev-cache] a production build ran since the last dev start: cleared .next/dev");
}
