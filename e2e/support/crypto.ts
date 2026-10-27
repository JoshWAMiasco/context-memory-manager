import type { APIRequestContext } from "@playwright/test";
import { ADMIN_PASSWORD } from "./environment";
import { readJson, waitForJobToFinish } from "./api";

export interface EncryptedFolder {
  /** The key file to unlock with: protected when a passphrase was set, else the raw one. */
  keyFile: Buffer;
  /** The raw key file kept offline; only with a passphrase. */
  recoveryKeyFile?: Buffer;
}

/**
 * Encrypts a folder through the same API calls the wizard makes (prepare, download, verify,
 * start) and waits for the job. The folder is left unlocked for this session.
 */
export async function encryptFolder(
  request: APIRequestContext,
  storageId: string,
  folderPath: string,
  passphrase?: string,
): Promise<EncryptedFolder> {
  const prepareResponse = await request.post("/api/crypto/prepare", {
    data: { storageId, path: folderPath, password: ADMIN_PASSWORD, passphrase },
  });
  if (!prepareResponse.ok()) throw new Error(`prepare failed: ${await prepareResponse.text()}`);
  const { pendingId } = await readJson<{ pendingId: string }>(prepareResponse);
  const keyFile = await (await request.get(`/api/crypto/keyfile/${pendingId}`)).body();
  const recoveryKeyFile = passphrase
    ? await (await request.get(`/api/crypto/keyfile/${pendingId}?variant=recovery`)).body()
    : undefined;
  const verifyResponse = await request.post("/api/crypto/verify", {
    multipart: { pendingId, keyfile: { name: "key.cmmkey", mimeType: "application/json", buffer: keyFile } },
  });
  if (!verifyResponse.ok()) throw new Error(`verify failed: ${await verifyResponse.text()}`);
  const startResponse = await request.post("/api/crypto/start", { data: { storageId, pendingId } });
  if (!startResponse.ok()) throw new Error(`start failed: ${await startResponse.text()}`);
  const { job } = await readJson<{ job: { id: string } }>(startResponse);
  const finished = await waitForJobToFinish(request, job.id);
  if (finished.status !== "done") throw new Error(`Encryption ended ${finished.status}: ${finished.error}`);
  return { keyFile, recoveryKeyFile };
}

export async function lockFolder(request: APIRequestContext, storageId: string, folderPath: string): Promise<void> {
  await request.post("/api/crypto/lock", { data: { storageId, path: folderPath } });
}

/** Unlocks through the API; returns the response so tests can look at refusals. */
export function unlockFolder(
  request: APIRequestContext,
  storageId: string,
  folderPath: string,
  keyFile: Buffer,
  passphrase?: string,
) {
  return request.post(`/api/crypto/unlock?storageId=${storageId}&path=${encodeURIComponent(folderPath)}`, {
    multipart: {
      keyfile: { name: "key.cmmkey", mimeType: "application/json", buffer: keyFile },
      password: ADMIN_PASSWORD,
      ...(passphrase ? { keyfilePassphrase: passphrase } : {}),
    },
  });
}
