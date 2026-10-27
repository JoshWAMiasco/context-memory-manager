import "server-only";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, constants, copyFile, mkdir, readdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { OfficeDetection } from "@/lib/api-types";
import { getConfig } from "@/server/config";
import { readFileHeader } from "@/server/crypto/format";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { getGlobalSingleton } from "@/server/runtime/global-singleton";
import { resolveInStorage } from "@/server/security/path-jail";
import { readCurrentEtag } from "@/server/storage/fs-ops";
import { runGuards, type FileActor } from "@/server/storage/pipeline";
import type { ActiveStorage } from "@/server/storage/roots";

const DETECT_TIMEOUT_MILLISECONDS = 15_000;
const DETECT_CACHE_MILLISECONDS = 60_000;
const CONVERT_TIMEOUT_MILLISECONDS = 120_000;
/** Larger files aren't converted: LibreOffice would take minutes and lots of memory. */
export const MAX_OFFICE_CONVERT_BYTES = 100 * 1024 * 1024;
/** Converted PDFs kept; the least recently used go first. */
const MAX_CACHED_PREVIEWS = 100;

interface OfficeState {
  detection?: OfficeDetection;
  checkedAt: number;
  pendingDetection?: Promise<OfficeDetection>;
  /** One conversion at a time: LibreOffice can't share its profile between two running copies. */
  queue: Promise<unknown>;
  /** Conversions in progress, by cache key, so the same file isn't converted twice at once. */
  inFlight: Map<string, Promise<string>>;
}

function getOfficeState(): OfficeState {
  return getGlobalSingleton("libreoffice", () => ({ checkedAt: 0, queue: Promise.resolve(), inFlight: new Map() }));
}

function runSoffice(
  binary: string,
  commandArguments: string[],
  timeout: number,
  environment?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      commandArguments,
      { timeout, windowsHide: true, env: environment ?? process.env },
      (runError, output) => (runError ? reject(runError) : resolve(String(output))),
    );
  });
}

/**
 * The version LibreOffice reports, from `soffice --version` ("LibreOffice 24.2.7.2 …").
 *
 * @example
 * parseLibreOfficeVersion("LibreOffice 24.2.7.2 420(Build:2)"); // "24.2.7.2"
 */
export function parseLibreOfficeVersion(output: string): string | undefined {
  return /LibreOffice\s+(\d+(?:\.\d+)+)/.exec(output)?.[1];
}

async function isExecutable(filePath: string): Promise<boolean> {
  return access(filePath, process.platform === "win32" ? constants.F_OK : constants.X_OK).then(
    () => true,
    () => false,
  );
}

/** Where to look: `CMM_SOFFICE_PATH`, then `PATH`, then where installers usually put it. */
function listCandidates(environment: Record<string, string | undefined>): string[] {
  const candidates: string[] = [];
  if (environment.CMM_SOFFICE_PATH) candidates.push(environment.CMM_SOFFICE_PATH);
  const names = process.platform === "win32" ? ["soffice.exe"] : ["soffice", "libreoffice"];
  for (const directory of (environment.PATH ?? environment.Path ?? "").split(path.delimiter)) {
    if (!directory) continue;
    // eslint-disable-next-line no-inline-comments -- runtime paths: keep Turbopack's tracer from following them
    for (const name of names) candidates.push(path.join(/* turbopackIgnore: true */ directory, name));
  }
  if (process.platform === "darwin") candidates.push("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  if (process.platform === "linux") {
    candidates.push("/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/snap/bin/libreoffice");
  }
  if (process.platform === "win32") {
    for (const programFiles of [environment.ProgramFiles, environment["ProgramFiles(x86)"]]) {
      if (programFiles) candidates.push(path.join(programFiles, "LibreOffice", "program", "soffice.exe"));
    }
  }
  return [...new Set(candidates)];
}

/** Looks for LibreOffice now (see `detectLibreOffice` for the cached answer). */
export async function probeLibreOffice(
  environment: Record<string, string | undefined> = process.env,
): Promise<OfficeDetection> {
  const checkedAt = new Date().toISOString();
  for (const candidate of listCandidates(environment)) {
    if (!(await isExecutable(candidate))) continue;
    const version = parseLibreOfficeVersion(
      await runSoffice(candidate, ["--version"], DETECT_TIMEOUT_MILLISECONDS).catch(() => ""),
    );
    if (version) return { installed: true, version, path: candidate, checkedAt };
  }
  return { installed: false, checkedAt };
}

/**
 * Whether LibreOffice is installed on this machine (it is never installed by CMM), checked at most
 * once a minute unless `force`.
 *
 * @example
 * const { installed } = await detectLibreOffice();
 */
export async function detectLibreOffice({ force = false }: { force?: boolean } = {}): Promise<OfficeDetection> {
  const state = getOfficeState();
  if (!force && state.detection && Date.now() - state.checkedAt < DETECT_CACHE_MILLISECONDS) return state.detection;
  state.pendingDetection ??= probeLibreOffice().finally(() => {
    state.pendingDetection = undefined;
  });
  const detection = await state.pendingDetection;
  state.detection = detection;
  state.checkedAt = Date.now();
  return detection;
}

function readPreviewsDirectory(): string {
  return path.join(getConfig().dataDir, "office-previews");
}

/** Keeps the newest `MAX_CACHED_PREVIEWS` converted PDFs. */
async function pruneCache(cacheDirectory: string): Promise<void> {
  const names = (await readdir(cacheDirectory).catch(() => [] as string[])).filter((name) => name.endsWith(".pdf"));
  if (names.length <= MAX_CACHED_PREVIEWS) return;
  const dated = await Promise.all(
    names.map(async (name) => ({ name, mtimeMs: (await stat(path.join(cacheDirectory, name))).mtimeMs })),
  );
  const oldest = dated
    .toSorted((first, second) => first.mtimeMs - second.mtimeMs)
    .slice(0, names.length - MAX_CACHED_PREVIEWS);
  await Promise.all(oldest.map(({ name }) => rm(path.join(cacheDirectory, name), { force: true })));
}

/** Converts one file with LibreOffice in a work folder of its own; resolves the PDF's path there. */
async function convertWithLibreOffice(binary: string, sourcePath: string, previewsDirectory: string): Promise<string> {
  const workDirectory = path.join(previewsDirectory, "work", randomUUID());
  const profileDirectory = path.join(previewsDirectory, "profile");
  await mkdir(workDirectory, { recursive: true, mode: 0o700 });
  await mkdir(profileDirectory, { recursive: true, mode: 0o700 });
  // A copy, so LibreOffice's lock and backup files never appear next to the user's file.
  const inputPath = path.join(workDirectory, `input${path.extname(sourcePath).toLowerCase()}`);
  await copyFile(sourcePath, inputPath);
  try {
    await runSoffice(
      binary,
      [
        "--headless",
        "--invisible",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        "--nofirststartwizard",
        `-env:UserInstallation=${pathToFileURL(profileDirectory).href}`,
        "--convert-to",
        "pdf",
        "--outdir",
        workDirectory,
        inputPath,
      ],
      CONVERT_TIMEOUT_MILLISECONDS,
      { ...process.env, HOME: profileDirectory },
    );
  } catch (convertError) {
    await rm(workDirectory, { recursive: true, force: true });
    const isTimeout = (convertError as { killed?: boolean }).killed === true;
    throw new ApiRouteError(
      isTimeout ? 504 : 422,
      isTimeout ? "OFFICE_TIMEOUT" : "OFFICE_CONVERSION_FAILED",
      isTimeout
        ? "LibreOffice took too long to convert this file. Download it to open it."
        : "LibreOffice couldn't convert this file. It may be damaged or password protected.",
    );
  }
  const outputPath = path.join(workDirectory, "input.pdf");
  if (!(await stat(outputPath).catch(() => undefined))) {
    await rm(workDirectory, { recursive: true, force: true });
    throw new ApiRouteError(422, "OFFICE_CONVERSION_FAILED", "LibreOffice couldn't convert this file.");
  }
  return outputPath;
}

/**
 * A PDF of an Office file (pptx, doc, xls, ppt, OpenDocument, RTF), made by LibreOffice on this
 * machine and cached by the file's version, so opening it again is instant. Files in an encrypted
 * folder are refused: a plaintext PDF would sit next to encrypted data. Conversions run one at a
 * time. Resolves the cached PDF's path.
 *
 * @example
 * const pdfPath = await convertOfficeFileToPdf(storage, "decks/q3.pptx", actor);
 */
export async function convertOfficeFileToPdf(
  storage: ActiveStorage,
  relativePath: string,
  actor: FileActor,
): Promise<string> {
  const resolvedPath = await resolveInStorage(storage, relativePath);
  const fileStats = await stat(resolvedPath.absolutePath);
  if (!fileStats.isFile()) throw validationFailed("Choose a file to preview.");
  await runGuards({
    type: "read",
    storageId: storage.id,
    path: resolvedPath.relativePath,
    absolutePath: resolvedPath.absolutePath,
    actor,
  });
  if ((await readFileHeader(resolvedPath.absolutePath)) !== undefined) {
    throw new ApiRouteError(
      422,
      "ENCRYPTED_NOT_CONVERTED",
      "Files in an encrypted folder aren't converted for preview, so no decrypted copy is made. Download it to open it.",
    );
  }
  if (fileStats.size > MAX_OFFICE_CONVERT_BYTES) {
    throw new ApiRouteError(413, "TOO_LARGE", "This file is too large to preview. Download it to open it.");
  }
  const detection = await detectLibreOffice();
  if (!detection.installed || !detection.path) {
    throw new ApiRouteError(409, "OFFICE_UNAVAILABLE", "LibreOffice isn't installed on the CMM computer.");
  }
  const binary = detection.path;
  const etag = (await readCurrentEtag(storage, resolvedPath.relativePath)) ?? "";
  const cacheKey = createHash("sha256").update(`${storage.id}\0${resolvedPath.relativePath}\0${etag}`).digest("hex");
  const previewsDirectory = readPreviewsDirectory();
  const cacheDirectory = path.join(previewsDirectory, "cache");
  const cachedPath = path.join(cacheDirectory, `${cacheKey}.pdf`);
  if (await stat(cachedPath).catch(() => undefined)) {
    const now = new Date();
    await utimes(cachedPath, now, now).catch(() => undefined);
    return cachedPath;
  }
  const state = getOfficeState();
  const inFlight = state.inFlight.get(cacheKey);
  if (inFlight) return inFlight;
  const conversion = state.queue
    .catch(() => undefined)
    .then(async () => {
      const outputPath = await convertWithLibreOffice(binary, resolvedPath.absolutePath, previewsDirectory);
      await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
      await rename(outputPath, cachedPath);
      await rm(path.dirname(outputPath), { recursive: true, force: true });
      await pruneCache(cacheDirectory);
      return cachedPath;
    })
    .finally(() => state.inFlight.delete(cacheKey));
  state.inFlight.set(cacheKey, conversion);
  state.queue = conversion;
  return conversion;
}
