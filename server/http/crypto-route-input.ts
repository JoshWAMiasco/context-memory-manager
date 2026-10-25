import "server-only";
import type { NextRequest } from "next/server";
import type { ResolvedSession } from "@/server/auth/session";
import { ApiRouteError, validationFailed } from "@/server/http/api-error";
import { MAX_KEY_FILE_BYTES } from "@/server/crypto/keyfile";
import { requirePasswordConfirm } from "@/server/security/password-confirm";
import { getRateLimiter } from "@/server/security/rate-limit";

/** Multipart bodies of the crypto routes hold a key file or two and short fields: 64 KB is plenty. */
const MAX_FORM_BYTES = 64 * 1024;

export interface CryptoForm {
  /** Uploaded files by field name, as bytes. */
  files: Map<string, Buffer>;
  /** Text fields by name. */
  fields: Map<string, string>;
}

/**
 * Reads a crypto route's multipart body (key files and short fields), refusing anything over
 * 64 KB and key files over 4 KB before they are parsed.
 *
 * @example
 * const form = await readCryptoForm(request);
 */
export async function readCryptoForm(request: NextRequest): Promise<CryptoForm> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) {
    throw validationFailed("The request is too large.");
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw validationFailed("Send the key file as multipart form data.");
  }
  const form: CryptoForm = { files: new Map(), fields: new Map() };
  for (const [fieldName, value] of formData.entries()) {
    if (typeof value === "string") {
      form.fields.set(fieldName, value.slice(0, 1024));
      continue;
    }
    if (value.size > MAX_KEY_FILE_BYTES) {
      throw new ApiRouteError(400, "WRONG_KEY_FILE", "That file is too large to be a CMM key file.");
    }
    form.files.set(fieldName, Buffer.from(await value.arrayBuffer()));
  }
  return form;
}

/** A required key file field. */
export function requireKeyFile(form: CryptoForm, fieldName = "keyfile"): Buffer {
  const keyFile = form.files.get(fieldName);
  if (!keyFile) throw validationFailed("Choose the folder's .cmmkey key file.");
  return keyFile;
}

/** Confirms the account password from the form's `password` field (rate-limited). */
export async function confirmFormPassword(form: CryptoForm, auth: ResolvedSession, clientIp: string): Promise<void> {
  const password = form.fields.get("password") ?? "";
  if (password === "") throw validationFailed("Enter your password.");
  await requirePasswordConfirm({ user: auth.user, password, ip: clientIp });
}

/**
 * Runs `action` with a key file the user chose; a key file that doesn't match counts as a failed
 * attempt per `ip|username`, locked out like wrong passwords.
 */
export async function withKeyFileAttempt<Result>(
  auth: ResolvedSession,
  clientIp: string,
  action: () => Promise<Result> | Result,
): Promise<Result> {
  const rateLimiter = getRateLimiter("key-file");
  const limiterKey = `${clientIp}|${auth.user.username}`;
  rateLimiter.assertAllowed(limiterKey);
  try {
    return await action();
  } catch (actionError) {
    if (actionError instanceof ApiRouteError && actionError.code === "WRONG_KEY_FILE") {
      throw rateLimiter.rejectAttempt(limiterKey, actionError);
    }
    throw actionError;
  }
}
