"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { EncryptedFolderSummary, EncryptionStatus, JobSummary } from "@/lib/api-types";
import { requestForm, requestJson } from "@/lib/client/api";
import { QUERY_KEYS } from "@/lib/client/query-keys";
import { readKeyFileProtection, type KeyFileProtection } from "@/lib/key-file";

/** A key file the user chose and, when it is passphrase-protected, the passphrase that opens it. */
export interface KeyFileChoice {
  file: File;
  passphrase?: string;
}

/** What a prepared key gives back: the pending slot and whether its key file asks for a passphrase. */
export interface PreparedKey {
  pendingId: string;
  folderName: string;
  hasPassphrase: boolean;
}

function buildQuery(storageId: string, entryPath: string): string {
  return new URLSearchParams({ storageId, path: entryPath }).toString();
}

function buildForm(fields: Record<string, string | File | undefined>): FormData {
  const formData = new FormData();
  for (const [fieldName, value] of Object.entries(fields)) if (value !== undefined) formData.append(fieldName, value);
  return formData;
}

/**
 * Whether an entry is in an encrypted folder, that folder's state and this session's unlock.
 *
 * @example
 * const { data: status } = useEncryptionStatus(storageId, "persona");
 */
export function useEncryptionStatus(storageId: string, entryPath: string, isEnabled = true) {
  return useQuery({
    queryKey: QUERY_KEYS.encryption(storageId, entryPath),
    queryFn: ({ signal }) =>
      requestJson<EncryptionStatus>(`/api/crypto/status?${buildQuery(storageId, entryPath)}`, { signal }),
    enabled: isEnabled,
  });
}

/** Every encrypted folder the user can see (Settings → Encryption, the header key icon). */
export function useEncryptedFolders() {
  return useQuery({
    queryKey: QUERY_KEYS.encryptedFolders(),
    queryFn: ({ signal }) => requestJson<EncryptedFolderSummary[]>("/api/crypto/scopes", { signal }),
  });
}

/**
 * The URL that downloads a pending key's `.cmmkey` file (wizard step 3); `recovery` is the raw
 * copy of a passphrase-protected key, to keep offline.
 */
export function buildKeyFileUrl(pendingId: string, variant: "key" | "recovery" = "key"): string {
  const url = `/api/crypto/keyfile/${encodeURIComponent(pendingId)}`;
  return variant === "recovery" ? `${url}?variant=recovery` : url;
}

/**
 * Whether a chosen key file asks for a passphrase, read in the browser from its version field
 * alone (the server validates everything else).
 *
 * @example
 * if ((await readKeyFileProtectionOf(file)) === "passphrase") showPassphraseField();
 */
export async function readKeyFileProtectionOf(file: File): Promise<KeyFileProtection> {
  try {
    return readKeyFileProtection(await file.text());
  } catch {
    return "unknown";
  }
}

function keyFileFields(
  fieldName: string,
  choice: KeyFileChoice | undefined,
): Record<string, string | File | undefined> {
  if (!choice) return {};
  return { [fieldName]: choice.file, [`${fieldName}Passphrase`]: choice.passphrase || undefined };
}

/**
 * Every encryption action. Each refreshes listings, file stats and encryption state of
 * the storage, since locking or encrypting a folder changes what every file in it shows.
 *
 * @example
 * const { unlock } = useEncryptionMutations();
 * await unlock.mutateAsync({ storageId, path: "persona", keyFile, password });
 */
export function useEncryptionMutations() {
  const queryClient = useQueryClient();
  const refresh = (storageId?: string) => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.encryption(storageId) });
    void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.encryptedFolders() });
    void queryClient.invalidateQueries({ queryKey: storageId ? QUERY_KEYS.storageDirectories(storageId) : ["fs"] });
    void queryClient.invalidateQueries({ queryKey: storageId ? ["fs", "stat", storageId] : ["fs"] });
    if (storageId) void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.folderState(storageId) });
  };
  const prepare = useMutation({
    mutationFn: (input: { storageId: string; path: string; password: string; passphrase?: string }) =>
      requestJson<PreparedKey>("/api/crypto/prepare", {
        method: "POST",
        body: { ...input, passphrase: input.passphrase || undefined },
      }),
  });
  const prepareRekey = useMutation({
    mutationFn: ({
      storageId,
      path,
      oldKeyFile,
      password,
      passphrase,
    }: {
      storageId: string;
      path: string;
      oldKeyFile: KeyFileChoice;
      password: string;
      /** Protects the new key file. */
      passphrase?: string;
    }) =>
      requestForm<PreparedKey>(
        `/api/crypto/rekey/prepare?${buildQuery(storageId, path)}`,
        buildForm({ ...keyFileFields("oldKeyfile", oldKeyFile), password, passphrase: passphrase || undefined }),
      ),
  });
  const verify = useMutation({
    mutationFn: ({ pendingId, keyFile }: { pendingId: string; keyFile: File }) =>
      requestForm<{ verified: true }>("/api/crypto/verify", buildForm({ pendingId, keyfile: keyFile })),
  });
  const start = useMutation({
    mutationFn: (input: { storageId: string; pendingId: string }) =>
      requestJson<{ job: JobSummary; scopePath: string }>("/api/crypto/start", { method: "POST", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  const unlock = useMutation({
    mutationFn: ({
      storageId,
      path,
      keyFile,
      password,
    }: {
      storageId: string;
      path: string;
      keyFile: KeyFileChoice;
      password: string;
    }) =>
      requestForm<EncryptionStatus>(
        `/api/crypto/unlock?${buildQuery(storageId, path)}`,
        buildForm({ ...keyFileFields("keyfile", keyFile), password }),
      ),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  const lock = useMutation({
    mutationFn: (input: { storageId: string; path: string }) =>
      requestJson<{ locked: true }>("/api/crypto/lock", { method: "POST", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  const lockAll = useMutation({
    mutationFn: () => requestJson<{ locked: true }>("/api/crypto/lock-all", { method: "POST" }),
    onSuccess: () => refresh(),
  });
  const decrypt = useMutation({
    mutationFn: ({
      storageId,
      path,
      keyFile,
      password,
      confirmName,
    }: {
      storageId: string;
      path: string;
      keyFile: KeyFileChoice;
      password: string;
      confirmName: string;
    }) =>
      requestForm<{ job: JobSummary }>(
        `/api/crypto/decrypt?${buildQuery(storageId, path)}`,
        buildForm({ ...keyFileFields("keyfile", keyFile), password, confirmName }),
      ),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  const encryptPlaintext = useMutation({
    mutationFn: (input: { storageId: string; path: string }) =>
      requestJson<{ job: JobSummary }>("/api/crypto/encrypt-plaintext", { method: "POST", body: input }),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  const resume = useMutation({
    mutationFn: ({
      storageId,
      path,
      keyFile,
      newKeyFile,
      password,
    }: {
      storageId: string;
      path: string;
      keyFile: KeyFileChoice;
      newKeyFile?: KeyFileChoice;
      password: string;
    }) =>
      requestForm<{ job: JobSummary }>(
        `/api/crypto/resume?${buildQuery(storageId, path)}`,
        buildForm({ ...keyFileFields("keyfile", keyFile), ...keyFileFields("newKeyfile", newKeyFile), password }),
      ),
    onSuccess: (_result, input) => refresh(input.storageId),
  });
  return { prepare, prepareRekey, verify, start, unlock, lock, lockAll, decrypt, encryptPlaintext, resume, refresh };
}
