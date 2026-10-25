/*
 * Fails the build when the output contains a URL the app could fetch at runtime.
 *
 * Scans .next/static/**\/*.{js,css}, .next/standalone/**\/*.js, the desktop app's main process
 * (electron/**\/*.{ts,html}) and the server admin CLI (server/cli/**\/*.ts), where only the project-wide
 * rules apply, for http(s) URL literals whose host looks real (has a dot). Each one must match a rule
 * in scripts/offline-allowlist.json; anything else is reported with its file and the build exits
 * with status 1.
 *
 * `--package <dir>` scans an assembled server package instead (scripts/package-server.ts): its
 * `app/.next/static` files are matched as `static/…`, the rest of `app/` as `standalone/…`, so the
 * same rules apply.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

interface AllowlistRule {
  reason: string;
  files: string;
  urlPattern: string;
}

interface CompiledRule {
  filesExpression: RegExp;
  urlExpression: RegExp;
}

interface Finding {
  file: string;
  url: string;
}

const projectRoot = path.resolve(__dirname, "..");
const buildDirectory = path.join(projectRoot, ".next");
const URL_LITERAL_EXPRESSION = /https?:\/\/[^\s"'`<>()\\{}|^[\]]+/g;
const FETCHABLE_HOST_EXPRESSION = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

function globToExpression(globPattern: string): RegExp {
  const expressionSource = globPattern
    .split("**")
    .map((globPart) =>
      globPart
        .split("*")
        .map((literalPart) => literalPart.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${expressionSource}$`);
}

function loadRules(): CompiledRule[] {
  const allowlist = JSON.parse(readFileSync(path.join(projectRoot, "scripts", "offline-allowlist.json"), "utf8")) as {
    rules: AllowlistRule[];
  };
  return allowlist.rules.map((rule) => ({
    filesExpression: globToExpression(rule.files),
    urlExpression: new RegExp(rule.urlPattern, "i"),
  }));
}

function listFiles(directory: string, extensions: readonly string[]): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function toRulePath(filePath: string): string {
  return path.relative(buildDirectory, filePath).split(path.sep).join("/");
}

/** A package file's path as the rules see it: `app/.next/static/x` → `static/x`, `app/x` → `standalone/x`. */
function toPackageRulePath(packageDirectory: string, filePath: string): string {
  const packagePath = path.relative(packageDirectory, filePath).split(path.sep).join("/");
  if (packagePath.startsWith("app/.next/static/")) return `static/${packagePath.slice("app/.next/static/".length)}`;
  if (packagePath.startsWith("app/")) return `standalone/${packagePath.slice("app/".length)}`;
  return `package/${packagePath}`;
}

function scanFile(filePath: string, rules: readonly CompiledRule[], relativePath = toRulePath(filePath)): Finding[] {
  const fileText = readFileSync(filePath, "utf8");
  const findings: Finding[] = [];
  for (const urlMatch of fileText.matchAll(URL_LITERAL_EXPRESSION)) {
    const url = urlMatch[0];
    if (!FETCHABLE_HOST_EXPRESSION.test(url)) continue;
    const isAllowed = rules.some((rule) => rule.filesExpression.test(relativePath) && rule.urlExpression.test(url));
    if (!isAllowed) findings.push({ file: relativePath, url });
  }
  return findings;
}

function report(findings: readonly Finding[], scannedCount: number): void {
  if (findings.length === 0) {
    console.log(`[check-offline] OK: ${scannedCount} files scanned, no fetchable external URLs.`);
    return;
  }

  const findingsByFile = new Map<string, Set<string>>();
  for (const finding of findings) {
    const fileUrls = findingsByFile.get(finding.file) ?? new Set<string>();
    fileUrls.add(finding.url);
    findingsByFile.set(finding.file, fileUrls);
  }
  console.error(
    `[check-offline] FAILED: ${findings.length} external URL(s) in ${findingsByFile.size} file(s) are not in scripts/offline-allowlist.json:\n`,
  );
  for (const [file, fileUrls] of findingsByFile) {
    console.error(`  ${file}`);
    for (const url of fileUrls) console.error(`    ${url}`);
  }
  console.error("\nRemove the network use, or add a rule with a reason if the URL is never fetched.");
  process.exit(1);
}

function scanPackage(packageDirectory: string): void {
  if (!existsSync(path.join(packageDirectory, "app"))) {
    console.error(`[check-offline] ${packageDirectory} is not a server package (no app/ folder).`);
    process.exit(1);
  }
  const rules = loadRules();
  const scannedFiles = listFiles(packageDirectory, [".js", ".cjs", ".mjs", ".css"]);
  const findings = scannedFiles.flatMap((filePath) =>
    scanFile(filePath, rules, toPackageRulePath(packageDirectory, filePath)),
  );
  report(findings, scannedFiles.length);
}

function main(): void {
  const packageFlagIndex = process.argv.indexOf("--package");
  if (packageFlagIndex !== -1) {
    scanPackage(path.resolve(process.argv[packageFlagIndex + 1] ?? ""));
    return;
  }
  const staticDirectory = path.join(buildDirectory, "static");
  const standaloneDirectory = path.join(buildDirectory, "standalone");
  if (!existsSync(staticDirectory) || !existsSync(standaloneDirectory)) {
    console.error("[check-offline] .next/static or .next/standalone is missing. Run `next build` first.");
    process.exit(1);
  }

  const rules = loadRules();
  const scannedFiles = [
    ...listFiles(staticDirectory, [".js", ".css"]),
    ...listFiles(standaloneDirectory, [".js"]),
    ...listFiles(path.join(projectRoot, "electron"), [".ts", ".html"]),
    ...listFiles(path.join(projectRoot, "server", "cli"), [".ts"]),
  ];
  report(
    scannedFiles.flatMap((filePath) => scanFile(filePath, rules)),
    scannedFiles.length,
  );
}

main();
