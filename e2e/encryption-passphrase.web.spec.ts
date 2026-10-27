import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { APIRequestContext, Page } from "@playwright/test";
import { encryptFolder, lockFolder, unlockFolder } from "./support/crypto";
import { ADMIN_PASSWORD } from "./support/environment";
import { expect, openRowMenu, test, treeRow, type Workspace } from "./support/fixtures";

const PASSPHRASE = "correct horse battery staple";
const SECRET = "top secret plaintext";

function startsWithEncryptedHeader(file: string): boolean {
  return readFileSync(file).subarray(0, 4).toString("ascii") === "CCM1";
}

/**
 * Opens the Enable encryption wizard from the folder overview's "Enable encryption" button, or the
 * Re-key wizard from Folder settings → Encryption. (The wizard started from the Encryption tab of an
 * unencrypted folder closes itself when encryption starts: the tab then shows the job instead.)
 */
async function openEncryptionWizard(page: Page, workspace: Workspace, mode: "encrypt" | "rekey"): Promise<void> {
  await page.goto(workspace.url("vault"));
  if (mode === "encrypt") {
    await page.getByTestId("quick-encryption").click();
  } else {
    const menu = await openRowMenu(page, workspace.path("vault"));
    await menu.getByTestId("menu-folder-settings").click();
    await page.getByRole("tab", { name: "Encryption" }).click();
    await page.getByTestId("encryption-rekey").click();
  }
  await expect(page.getByTestId("encryption-wizard")).toBeVisible();
}

async function download(page: Page, testId: string, target: string): Promise<Buffer> {
  const [downloaded] = await Promise.all([page.waitForEvent("download"), page.getByTestId(testId).click()]);
  await downloaded.saveAs(target);
  return readFileSync(target);
}

test.describe("passphrase-protected key files", () => {
  test("the wizard protects the key file, offers a recovery copy, and unlocking asks once", async ({
    page,
    request,
    workspace,
  }, testInfo) => {
    workspace.writeText("vault/secret.txt", SECRET);
    workspace.writeText("vault/second.txt", "second plaintext");
    await openEncryptionWizard(page, workspace, "encrypt");
    const wizard = page.getByTestId("encryption-wizard");

    await wizard.getByTestId("wizard-understand").check();
    await wizard.getByTestId("wizard-next").click();

    /* Step 2: the passphrase must be long enough and typed twice. */
    await wizard.locator("#wizard-password").fill(ADMIN_PASSWORD);
    await wizard.getByTestId("wizard-passphrase-on").check();
    await wizard.getByTestId("wizard-passphrase").fill("short");
    await wizard.getByTestId("wizard-passphrase-again").fill("short");
    await expect(wizard.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(wizard.getByTestId("wizard-next")).toBeDisabled();
    await wizard.getByTestId("wizard-passphrase").fill(PASSPHRASE);
    await wizard.getByTestId("wizard-passphrase-again").fill(`${PASSPHRASE} typo`);
    await expect(wizard.getByText("The passphrases don't match.")).toBeVisible();
    await expect(wizard.getByTestId("wizard-next")).toBeDisabled();
    await wizard.getByTestId("wizard-passphrase-again").fill(PASSPHRASE);
    await expect(wizard.getByTestId("wizard-next")).toBeEnabled();
    await wizard.getByTestId("wizard-next").click();

    /* Step 3: the key file is protected, and a raw recovery copy is offered. */
    await expect(wizard.getByTestId("wizard-recovery")).toBeVisible();
    const keyPath = testInfo.outputPath("vault.cmmkey");
    const recoveryPath = testInfo.outputPath("vault.recovery.cmmkey");
    const protectedDocument = JSON.parse((await download(page, "wizard-download", keyPath)).toString("utf8"));
    const recoveryDocument = JSON.parse(
      (await download(page, "wizard-download-recovery", recoveryPath)).toString("utf8"),
    );
    expect(protectedDocument).toMatchObject({ v: 2, kdf: { algorithm: "argon2id" } });
    expect(protectedDocument.key).toBeUndefined();
    expect(recoveryDocument).toMatchObject({ v: 1 });
    expect(recoveryDocument.key).toEqual(expect.any(String));
    expect(path.basename(recoveryPath)).toContain("recovery");
    await wizard.getByTestId("wizard-next").click();

    /* Step 4: something that is not the key file is refused; the real one is accepted. */
    await wizard.getByTestId("wizard-verify-key-input").setInputFiles({
      name: "not-a-key.cmmkey",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
    await expect(wizard.getByText(/not a CMM key file/i)).toBeVisible();
    await wizard.getByTestId("wizard-verify-key-input").setInputFiles(keyPath);
    await expect(wizard.getByTestId("wizard-verified")).toBeVisible();
    await wizard.getByTestId("wizard-next").click();

    /* Step 5: encrypt. The files on disk are ciphertext afterwards. */
    await wizard.getByTestId("wizard-start").click();
    await expect(wizard.getByTestId("wizard-done")).toBeVisible({ timeout: 60_000 });
    await wizard.getByTestId("wizard-close").click();
    expect(startsWithEncryptedHeader(workspace.disk("vault", "secret.txt"))).toBe(true);
    expect(readFileSync(workspace.disk("vault", "secret.txt")).toString("latin1")).not.toContain(SECRET);

    /* Unlocking: the protected key file asks for its passphrase, once. */
    await lockFolder(request, workspace.firstStorageId, workspace.path("vault"));
    await page.goto(workspace.url("vault", "secret.txt"));
    const panel = page.getByTestId("unlock-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("unlock-keyfile-dropzone-input").setInputFiles(keyPath);
    const passphraseField = panel.getByTestId("unlock-keyfile-passphrase");
    await expect(passphraseField).toBeVisible();
    await panel.locator("#unlock-password").fill(ADMIN_PASSWORD);

    await passphraseField.locator("input").fill("not the passphrase");
    await panel.getByTestId("unlock-submit").click();
    await expect(panel.getByText("Wrong passphrase for this key file.")).toBeVisible();

    await passphraseField.locator("input").fill(PASSPHRASE);
    await panel.getByTestId("unlock-submit").click();
    await expect(panel).toBeHidden();
    await expect(page.getByText(SECRET)).toBeVisible();

    /* Another file in the unlocked folder opens with no further prompt. */
    await treeRow(page, workspace.path("vault", "second.txt")).click();
    await expect(page.getByText("second plaintext")).toBeVisible();
    await expect(page.getByTestId("unlock-panel")).toHaveCount(0);

    /* The recovery key file opens the folder with no passphrase at all. */
    await lockFolder(request, workspace.firstStorageId, workspace.path("vault"));
    await page.reload();
    await expect(panel).toBeVisible();
    await panel.getByTestId("unlock-keyfile-dropzone-input").setInputFiles(recoveryPath);
    await expect(panel.locator("#unlock-password")).toBeVisible();
    await expect(panel.getByTestId("unlock-keyfile-passphrase")).toHaveCount(0);
    await panel.locator("#unlock-password").fill(ADMIN_PASSWORD);
    await panel.getByTestId("unlock-submit").click();
    await expect(panel).toBeHidden();
    /* The reload kept the last file opened, second.txt. */
    await expect(page.getByText("second plaintext")).toBeVisible();
  });

  test("leaving the passphrase off gives one raw key file and no recovery copy", async ({
    page,
    request,
    workspace,
  }, testInfo) => {
    workspace.writeText("vault/secret.txt", SECRET);
    await openEncryptionWizard(page, workspace, "encrypt");
    const wizard = page.getByTestId("encryption-wizard");
    await wizard.getByTestId("wizard-understand").check();
    await wizard.getByTestId("wizard-next").click();
    await wizard.locator("#wizard-password").fill(ADMIN_PASSWORD);
    await expect(wizard.getByTestId("wizard-passphrase")).toHaveCount(0);
    await wizard.getByTestId("wizard-next").click();

    await expect(wizard.getByTestId("wizard-recovery")).toHaveCount(0);
    const keyPath = testInfo.outputPath("vault.cmmkey");
    const keyDocument = JSON.parse((await download(page, "wizard-download", keyPath)).toString("utf8"));
    expect(keyDocument).toMatchObject({ v: 1 });
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-verify-key-input").setInputFiles(keyPath);
    await expect(wizard.getByTestId("wizard-verified")).toBeVisible();
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-start").click();
    await expect(wizard.getByTestId("wizard-done")).toBeVisible({ timeout: 60_000 });
    await wizard.getByTestId("wizard-close").click();

    await lockFolder(request, workspace.firstStorageId, workspace.path("vault"));
    await page.goto(workspace.url("vault", "secret.txt"));
    const panel = page.getByTestId("unlock-panel");
    await panel.getByTestId("unlock-keyfile-dropzone-input").setInputFiles(keyPath);
    await expect(panel.getByTestId("unlock-keyfile-passphrase")).toHaveCount(0);
    await panel.locator("#unlock-password").fill(ADMIN_PASSWORD);
    await panel.getByTestId("unlock-submit").click();
    await expect(page.getByText(SECRET)).toBeVisible();
  });

  test("re-keying replaces a raw key file with a passphrase-protected one", async ({
    page,
    request,
    workspace,
  }, testInfo) => {
    workspace.writeText("vault/secret.txt", SECRET);
    const first = await encryptFolder(request, workspace.firstStorageId, workspace.path("vault"));
    const oldKeyPath = testInfo.outputPath("old.cmmkey");
    writeFileSync(oldKeyPath, first.keyFile);

    await openEncryptionWizard(page, workspace, "rekey");
    const wizard = page.getByTestId("encryption-wizard");
    await wizard.getByTestId("wizard-understand").check();
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-old-key-dropzone-input").setInputFiles(oldKeyPath);
    await wizard.locator("#wizard-password").fill(ADMIN_PASSWORD);
    await wizard.getByTestId("wizard-passphrase-on").check();
    await wizard.getByTestId("wizard-passphrase").fill(PASSPHRASE);
    await wizard.getByTestId("wizard-passphrase-again").fill(PASSPHRASE);
    await wizard.getByTestId("wizard-next").click();

    await expect(wizard.getByTestId("wizard-recovery")).toBeVisible();
    const newKeyPath = testInfo.outputPath("new.cmmkey");
    expect(JSON.parse((await download(page, "wizard-download", newKeyPath)).toString("utf8")).v).toBe(2);
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-verify-key-input").setInputFiles(newKeyPath);
    await expect(wizard.getByTestId("wizard-verified")).toBeVisible();
    await wizard.getByTestId("wizard-next").click();
    await wizard.getByTestId("wizard-start").click();
    await expect(wizard.getByTestId("wizard-done")).toBeVisible({ timeout: 60_000 });
    await wizard.getByTestId("wizard-close").click();

    /* The new protected key opens the folder; the old raw key no longer does. */
    await lockFolder(request, workspace.firstStorageId, workspace.path("vault"));
    const withNew = await unlockFolder(
      request,
      workspace.firstStorageId,
      workspace.path("vault"),
      readFileSync(newKeyPath),
      PASSPHRASE,
    );
    expect(withNew.ok()).toBe(true);
    await lockFolder(request, workspace.firstStorageId, workspace.path("vault"));
    const withOld = await unlockFolder(request, workspace.firstStorageId, workspace.path("vault"), first.keyFile);
    expect(withOld.status()).toBe(400);
  });
});

test.describe("moving out of an encrypted folder", () => {
  /** Right-click → Move to… → the "outside" folder next to the vault → Move here. */
  async function moveDocumentOut(page: Page, workspace: Workspace): Promise<void> {
    const menu = await openRowMenu(page, workspace.path("vault", "doc.txt"));
    await menu.getByTestId("menu-move").click();
    const dialog = page.getByTestId("move-dialog");
    const picker = dialog.getByTestId("move-folder-picker");
    await picker.getByRole("button", { name: "Up one level" }).click();
    await picker.getByRole("option", { name: "outside" }).click();
    await dialog.getByTestId("move-confirm").click();
  }

  async function setUp(page: Page, request: APIRequestContext, workspace: Workspace): Promise<void> {
    workspace.writeText("vault/doc.txt", SECRET);
    workspace.makeFolder("outside");
    await encryptFolder(request, workspace.firstStorageId, workspace.path("vault"));
    expect(startsWithEncryptedHeader(workspace.disk("vault", "doc.txt"))).toBe(true);
    await page.goto(workspace.url("vault", "doc.txt"));
  }

  test("asks to confirm the decryption, and cancelling leaves the file where it was", async ({
    page,
    request,
    workspace,
  }) => {
    await setUp(page, request, workspace);
    await moveDocumentOut(page, workspace);
    const confirmation = page.getByTestId("confirm-decrypt-dialog");
    await expect(confirmation).toBeVisible();
    await expect(page.getByText("Move out of the encrypted folder?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toBeHidden();
    expect(startsWithEncryptedHeader(workspace.disk("vault", "doc.txt"))).toBe(true);
    expect(existsSync(workspace.disk("outside", "doc.txt"))).toBe(false);
  });

  /*
   * KNOWN ISSUE, present in 1.1.1 as well (reproduced on the build before this release): a confirmed
   * move out of an encrypted folder runs as a background job, and the job copies the file without
   * decrypting it, so the folder outside holds unreadable ciphertext (a confirmed copy, which runs
   * inline, does decrypt). `test.fail` keeps the suite green while that is so and turns red the day it
   * is fixed, as a reminder to drop it.
   */
  test("decrypts the file when the move is confirmed", async ({ page, request, workspace }) => {
    test.fail(true, "a confirmed move out of an encrypted folder leaves ciphertext behind (also in 1.1.1)");
    await setUp(page, request, workspace);
    await moveDocumentOut(page, workspace);
    await expect(page.getByTestId("confirm-decrypt-dialog")).toBeVisible();
    await page.getByRole("button", { name: "Move and decrypt" }).click();
    await expect.poll(() => existsSync(workspace.disk("outside", "doc.txt")), { timeout: 30_000 }).toBe(true);
    const moved = readFileSync(workspace.disk("outside", "doc.txt"));
    expect(startsWithEncryptedHeader(workspace.disk("outside", "doc.txt"))).toBe(false);
    expect(moved.toString("utf8")).toBe(SECRET);
  });
});
