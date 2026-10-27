import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ApiRouteError } from "@/server/http/api-error";
import {
  buildKeyFile,
  buildProtectedKeyFile,
  computeKeyCheck,
  generateFolderKey,
  matchKeyFile,
  parseKeyFile,
  readKeyFileKind,
} from "@/server/crypto/keyfile";

const PASSPHRASE = "correct horse battery";

function makeKeyFile() {
  return { ...generateFolderKey(), folderId: randomUUID(), folderName: "persona", createdAt: "2026-10-27T00:00:00Z" };
}

async function expectCode(action: Promise<unknown>, code: string): Promise<void> {
  const thrown = await action.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(thrown).toBeInstanceOf(ApiRouteError);
  expect((thrown as ApiRouteError).code).toBe(code);
}

describe("passphrase-protected key files", () => {
  it("wraps and unwraps the key with the passphrase", async () => {
    const keyFile = makeKeyFile();
    const bytes = await buildProtectedKeyFile(keyFile, PASSPHRASE);
    const document = JSON.parse(bytes.toString("utf8"));
    expect(document.v).toBe(2);
    expect(document.key).toBeUndefined();
    expect(bytes.toString("utf8")).not.toContain(keyFile.dek.toString("base64"));
    expect(readKeyFileKind(bytes)).toBe("passphrase");

    const parsed = await parseKeyFile({ bytes, passphrase: PASSPHRASE });
    expect(parsed.isProtected).toBe(true);
    expect(parsed.dek.equals(keyFile.dek)).toBe(true);
    expect(parsed.keyId.equals(keyFile.keyId)).toBe(true);
    expect(parsed.folderId).toBe(keyFile.folderId);
    expect(
      matchKeyFile(parsed, {
        folderId: keyFile.folderId,
        keyId: keyFile.keyId.toString("base64"),
        keyCheck: computeKeyCheck(keyFile.dek, keyFile.keyId),
      }),
    ).toBe(true);
  });

  it("rejects a wrong or missing passphrase", async () => {
    const bytes = await buildProtectedKeyFile(makeKeyFile(), PASSPHRASE);
    await expectCode(parseKeyFile({ bytes, passphrase: `${PASSPHRASE} ` }), "WRONG_PASSPHRASE");
    await expectCode(parseKeyFile({ bytes }), "KEY_FILE_PASSPHRASE_REQUIRED");
    await expectCode(parseKeyFile({ bytes, passphrase: "" }), "KEY_FILE_PASSPHRASE_REQUIRED");
  });

  it("rejects a wrapped key moved into another key file", async () => {
    const first = makeKeyFile();
    const second = makeKeyFile();
    const firstDocument = JSON.parse((await buildProtectedKeyFile(first, PASSPHRASE)).toString("utf8"));
    const secondDocument = JSON.parse((await buildProtectedKeyFile(second, PASSPHRASE)).toString("utf8"));
    const spliced = { ...secondDocument, kdf: firstDocument.kdf, wrapped: firstDocument.wrapped };
    await expectCode(
      parseKeyFile({ bytes: Buffer.from(JSON.stringify(spliced)), passphrase: PASSPHRASE }),
      "WRONG_PASSPHRASE",
    );
  });

  it("refuses a short passphrase", async () => {
    await expectCode(buildProtectedKeyFile(makeKeyFile(), "short"), "VALIDATION_FAILED");
  });

  it("uses a fresh salt and nonce for every file", async () => {
    const keyFile = makeKeyFile();
    const first = JSON.parse((await buildProtectedKeyFile(keyFile, PASSPHRASE)).toString("utf8"));
    const second = JSON.parse((await buildProtectedKeyFile(keyFile, PASSPHRASE)).toString("utf8"));
    expect(first.kdf.salt).not.toBe(second.kdf.salt);
    expect(first.wrapped.nonce).not.toBe(second.wrapped.nonce);
    expect(first.wrapped.key).not.toBe(second.wrapped.key);
  });
});

describe("raw (v1) key files", () => {
  it("still read as before, with or without a passphrase given", async () => {
    const keyFile = makeKeyFile();
    const bytes = buildKeyFile(keyFile);
    expect(JSON.parse(bytes.toString("utf8")).v).toBe(1);
    expect(readKeyFileKind(bytes)).toBe("raw");
    const parsed = await parseKeyFile({ bytes });
    expect(parsed.isProtected).toBe(false);
    expect(parsed.dek.equals(keyFile.dek)).toBe(true);
    const parsedAgain = await parseKeyFile({ bytes, passphrase: "ignored for raw files" });
    expect(parsedAgain.dek.equals(keyFile.dek)).toBe(true);
  });

  it("rejects a damaged checksum and files that are not key files", async () => {
    const document = JSON.parse(buildKeyFile(makeKeyFile()).toString("utf8"));
    document.checksum = "0000000000000000";
    await expectCode(parseKeyFile({ bytes: Buffer.from(JSON.stringify(document)) }), "WRONG_KEY_FILE");
    await expectCode(parseKeyFile({ bytes: Buffer.from("not json") }), "WRONG_KEY_FILE");
    await expectCode(parseKeyFile({ bytes: Buffer.from(JSON.stringify({ v: 3 })) }), "WRONG_KEY_FILE");
    expect(readKeyFileKind(Buffer.from("{}"))).toBe("unknown");
  });
});
