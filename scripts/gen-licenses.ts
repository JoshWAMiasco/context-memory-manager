/*
 * Writes public/licenses.json: name, version, license and author of every runtime dependency
 *, for the About page. Runs before `next build`. URLs are left out on purpose: the
 * offline bundle check treats every URL as a possible network call.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  license?: string | { type?: string };
  author?: string | { name?: string };
  dependencies?: Record<string, string>;
}

const projectRoot = path.resolve(__dirname, "..");

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function describeAuthor(author: PackageManifest["author"]): string | undefined {
  const authorText = typeof author === "string" ? author : author?.name;
  return authorText?.replace(/\s*[<(].*$/, "").trim() || undefined;
}

function generateLicenses(): void {
  const rootManifest = readManifest(path.join(projectRoot, "package.json"));
  const pending = Object.keys(rootManifest.dependencies ?? {});
  const seen = new Map<string, { name: string; version: string; license: string; author?: string }>();
  while (pending.length > 0) {
    const packageName = pending.shift() ?? "";
    if (seen.has(packageName)) continue;
    const manifestPath = path.join(projectRoot, "node_modules", packageName, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readManifest(manifestPath);
    const license = typeof manifest.license === "string" ? manifest.license : (manifest.license?.type ?? "See package");
    seen.set(packageName, {
      name: manifest.name,
      version: manifest.version,
      license,
      author: describeAuthor(manifest.author),
    });
    pending.push(...Object.keys(manifest.dependencies ?? {}));
  }
  const licenses = [...seen.values()].toSorted((first, second) => first.name.localeCompare(second.name));
  writeFileSync(path.join(projectRoot, "public", "licenses.json"), `${JSON.stringify(licenses, undefined, 1)}\n`);
  console.log(`[gen-licenses] wrote public/licenses.json (${licenses.length} packages)`);
}

generateLicenses();
