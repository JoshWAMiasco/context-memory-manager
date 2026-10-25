/*
 * Removes the previous build's dist/app and .next/standalone before `next build`. Next's file
 * tracer matches some files (tsconfig.json) anywhere under the project, so an old dist/app would
 * be copied into the new standalone output, and from there into the next dist/app, one level
 * deeper every build.
 */
import { rmSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..");

for (const outputDirectory of [path.join(projectRoot, "dist", "app"), path.join(projectRoot, ".next", "standalone")]) {
  rmSync(outputDirectory, { recursive: true, force: true });
}
