/*
 * The main-process side of `window.ccmDesktop`. Every handler checks that the call
 * comes from the app's own page and validates its arguments before touching the dialog or the
 * shell.
 */
import { access } from "node:fs/promises";
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron";
import { DESKTOP_CHANNELS, isBridgePath, isExternalLink } from "@/lib/desktop-bridge";
import { describeExternalLink } from "./navigation";

/**
 * Asks before a link leaves the app, then opens it in the default browser. Resolves true when it
 * was opened.
 *
 * @example
 * await confirmAndOpenExternal(mainWindow, "https://example.com");
 */
export async function confirmAndOpenExternal(parentWindow: BrowserWindow | null, url: string): Promise<boolean> {
  if (!isExternalLink(url)) return false;
  const options: Electron.MessageBoxOptions = {
    type: "question",
    buttons: ["Open in Browser", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: `Open ${describeExternalLink(url)} in your browser?`,
    detail: `${url}\n\nThis link leaves CCM and opens in your default browser, which may use the network.`,
  };
  const { response } = parentWindow
    ? await dialog.showMessageBox(parentWindow, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return false;
  await shell.openExternal(url);
  return true;
}

/**
 * Registers the bridge's handlers. `readAppOrigin` gives the current `http://127.0.0.1:<port>`
 * (it changes when the server restarts); calls from any other page are refused.
 *
 * @example
 * registerDesktopIpc(() => currentOrigin);
 */
export function registerDesktopIpc(readAppOrigin: () => string | undefined): void {
  const assertAppSender = (event: IpcMainInvokeEvent) => {
    const senderUrl = event.senderFrame?.url ?? "";
    let senderOrigin: string | undefined;
    try {
      senderOrigin = new URL(senderUrl).origin;
    } catch {
      senderOrigin = undefined;
    }
    if (!senderOrigin || senderOrigin !== readAppOrigin()) throw new Error("Refused: not the CCM window.");
  };

  ipcMain.handle(DESKTOP_CHANNELS.pickFolder, async (event) => {
    assertAppSender(event);
    const options: Electron.OpenDialogOptions = {
      title: "Choose a folder",
      buttonLabel: "Choose",
      properties: ["openDirectory", "createDirectory"],
    };
    const parentWindow = BrowserWindow.fromWebContents(event.sender);
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle(DESKTOP_CHANNELS.revealPath, async (event, absolutePath: unknown) => {
    assertAppSender(event);
    if (!isBridgePath(absolutePath)) return false;
    const exists = await access(absolutePath).then(
      () => true,
      () => false,
    );
    if (!exists) return false;
    shell.showItemInFolder(absolutePath);
    return true;
  });

  ipcMain.handle(DESKTOP_CHANNELS.openExternal, async (event, url: unknown) => {
    assertAppSender(event);
    if (!isExternalLink(url)) return false;
    return confirmAndOpenExternal(BrowserWindow.fromWebContents(event.sender), url);
  });
}
