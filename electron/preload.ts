/*
 * The desktop window's preload. Runs sandboxed with context isolation and exposes only
 * `window.cmmDesktop`: platform facts, calls that go to the main process through
 * `ipcRenderer.invoke` (with their arguments checked here first), and the local path of a dropped file.
 */
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { DESKTOP_CHANNELS, isBridgePath, isExternalLink, type CmmDesktopBridge } from "@/lib/desktop-bridge";

const APP_VERSION_ARGUMENT = "--cmm-app-version=";

/** The main process passes its version on the command line (`additionalArguments`). */
const appVersion =
  process.argv.find((argument) => argument.startsWith(APP_VERSION_ARGUMENT))?.slice(APP_VERSION_ARGUMENT.length) ?? "";

const bridge: CmmDesktopBridge = {
  isDesktop: true,
  platform: process.platform,
  appVersion,
  pickFolder: async () => {
    const pickedPath: unknown = await ipcRenderer.invoke(DESKTOP_CHANNELS.pickFolder);
    return typeof pickedPath === "string" ? pickedPath : null;
  },
  revealPath: async (absolutePath) => {
    if (!isBridgePath(absolutePath)) return false;
    return (await ipcRenderer.invoke(DESKTOP_CHANNELS.revealPath, absolutePath)) === true;
  },
  openFolder: async (absolutePath) => {
    if (!isBridgePath(absolutePath)) return false;
    return (await ipcRenderer.invoke(DESKTOP_CHANNELS.openFolder, absolutePath)) === true;
  },
  openExternal: async (url) => {
    if (!isExternalLink(url)) return false;
    return (await ipcRenderer.invoke(DESKTOP_CHANNELS.openExternal, url)) === true;
  },
  setTheme: (theme) => {
    if (theme === "dark" || theme === "light" || theme === "system")
      void ipcRenderer.invoke(DESKTOP_CHANNELS.setTheme, theme);
  },
  getPathForFile: (file) => {
    if (!(file instanceof File)) return null;
    const filePath = webUtils.getPathForFile(file);
    return isBridgePath(filePath) ? filePath : null;
  },
};

contextBridge.exposeInMainWorld("cmmDesktop", bridge);
