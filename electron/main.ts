/*
 * The CMM desktop app's main process. It runs the CMM server in a utility
 * process on a random `127.0.0.1` port with a per-launch token, shows a splash until the server is
 * healthy, then opens one hardened window on it. Nothing here talks to the network: no updater,
 * no spellchecker downloads, no background networking.
 */
import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, screen, session, shell, type WebContents } from "electron";
import { adoptLegacyEnvironment } from "@/lib/fs/legacy-names";
import { registerDesktopIpc, confirmAndOpenExternal } from "./ipc";
import { formatLogLine, RotatingLogFile } from "./log-file";
import { buildApplicationMenu } from "./menu";
import { classifyNavigation, isPermissionAllowed } from "./navigation";
import { buildServerEnvironment, createLaunchToken, findFreePort, waitForHealth } from "./server-launch";
import { DesktopServer } from "./server-process";
import { applyTheme, loadThemePreference, readCanvasColor, saveThemePreference } from "./theme";
import { MINIMUM_WINDOW_SIZE, readWindowState, writeWindowState } from "./window-state";

// Settings named CCM_… (before the rename to CMM) still apply.
adoptLegacyEnvironment(process.env);

const PRODUCT_NAME = "CMM";
const DESKTOP_GUIDE_FILE = "CMM-Desktop-Guide.pdf";
/** The server's SQLite file in userData (server/db/client.ts); Reset CMM deletes it. */
const DATABASE_FILE_NAME = "cmm.db";
const isMac = process.platform === "darwin";
const isDebug = process.env.CMM_DEBUG === "1";
const launchStartedAt = Date.now();

/** The app was called CCM before; its userData folder moves to CMM's on the first launch. */
const LEGACY_PRODUCT_NAME = "CCM";

function adoptLegacyUserData(userDataDirectory: string): void {
  const legacyUserData = path.join(path.dirname(userDataDirectory), LEGACY_PRODUCT_NAME);
  if (existsSync(userDataDirectory) || !existsSync(legacyUserData)) return;
  try {
    renameSync(legacyUserData, userDataDirectory);
  } catch (renameError) {
    console.error(`[cmm] could not move ${legacyUserData} to ${userDataDirectory}`, renameError);
  }
}

/*
 * userData is always "<appData>/CMM", whatever the executable is called. `CMM_DESKTOP_USER_DATA`
 * moves it (tests use a throwaway folder). It must be set before the single-instance lock, which
 * is held per userData folder.
 */
app.setName(PRODUCT_NAME);
const defaultUserData = path.join(app.getPath("appData"), PRODUCT_NAME);
if (!process.env.CMM_DESKTOP_USER_DATA) adoptLegacyUserData(defaultUserData);
app.setPath("userData", process.env.CMM_DESKTOP_USER_DATA || defaultUserData);
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-component-update");

const userDataDirectory = app.getPath("userData");
const logsDirectory = path.join(userDataDirectory, "logs");
const windowStatePath = path.join(userDataDirectory, "window-state.json");
const themePath = path.join(userDataDirectory, "theme.json");
applyTheme(loadThemePreference(themePath));
const mainLog = new RotatingLogFile(path.join(logsDirectory, "main.log"));
const serverLog = new RotatingLogFile(path.join(logsDirectory, "server.log"));

/** `resources/` in an installed app; in a dev run (`electron dist/electron`) the sibling `dist/` folders. */
const resourcesDirectory = app.isPackaged
  ? process.resourcesPath
  : process.env.CMM_DESKTOP_RESOURCES_DIR || path.resolve(__dirname, "..", "resources");
const serverEntryPath = app.isPackaged
  ? path.join(process.resourcesPath, "app-server", "entry.js")
  : path.resolve(__dirname, "..", "app", "entry.js");

const state: {
  server?: DesktopServer;
  origin?: string;
  mainWindow?: BrowserWindow;
  splashWindow?: BrowserWindow;
  isQuitting: boolean;
  hasStoppedServer: boolean;
} = { isQuitting: false, hasStoppedServer: false };

function log(message: string): void {
  mainLog.write(formatLogLine("main", message));
}

function openLogsFolder(): void {
  void shell.openPath(logsDirectory);
}

function openDesktopGuide(): void {
  const guidePath = path.join(resourcesDirectory, "docs", DESKTOP_GUIDE_FILE);
  if (!existsSync(guidePath)) {
    void dialog.showMessageBox({
      type: "info",
      message: "The Desktop Guide is not included in this build.",
      detail: guidePath,
    });
    return;
  }
  void shell.openPath(guidePath).then((openError) => {
    if (openError) log(`could not open the guide: ${openError}`);
  });
}

/**
 * Help › Reset CMM… (the desktop's answer to a forgotten password, documented in the guide): after
 * a confirmation, stops the server, deletes the database (accounts, settings, storages, backup
 * profiles) and starts again at the setup page. Files, folders and their `.cmm` settings stay.
 */
async function resetCmm(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Cancel", "Reset CMM"],
    defaultId: 0,
    cancelId: 0,
    message: "Reset CMM?",
    detail:
      "This deletes CMM's accounts, settings, storage list and backup profiles and history, then starts again " +
      "at the first-run setup, where you create a new account.\n\n" +
      "Your files and folders are not touched. Encrypted folders stay encrypted: unlock them with their key " +
      "file and the new account's password. Let running encryption and backup jobs finish first.",
  });
  if (response !== 1) return;
  log("reset: stopping the server and deleting the database");
  try {
    await state.server?.stop();
    for (const suffix of ["", "-wal", "-shm"]) {
      rmSync(path.join(userDataDirectory, `${DATABASE_FILE_NAME}${suffix}`), { force: true });
    }
    const origin = await startServer();
    const { mainWindow } = state;
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(`${origin}/`);
    else createMainWindow(origin);
    log("reset: done, back at setup");
  } catch (resetError) {
    await showStartupError(resetError);
  }
}

function showAbout(): void {
  app.setAboutPanelOptions({
    applicationName: PRODUCT_NAME,
    applicationVersion: app.getVersion(),
    version: `Electron ${process.versions.electron}`,
    credits: "Context Memory Manager. Runs entirely on this computer, offline.",
  });
  if (process.platform === "win32") {
    void dialog.showMessageBox({
      type: "info",
      message: `${PRODUCT_NAME} ${app.getVersion()}`,
      detail: "Context Memory Manager. Runs entirely on this computer, offline.",
    });
    return;
  }
  app.showAboutPanel();
}

function focusMainWindow(): void {
  const { mainWindow } = state;
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (state.origin && state.server?.isRunning) createMainWindow(state.origin);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Spellchecking off (and its dictionary downloads), and only clipboard writes and full screen allowed. */
function hardenSession(): void {
  const defaultSession = session.defaultSession;
  defaultSession.setSpellCheckerEnabled(false);
  defaultSession.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/");
  defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const isFromApp = state.origin !== undefined && details.requestingUrl.startsWith(`${state.origin}/`);
    callback(isFromApp && isPermissionAllowed(permission));
  });
  defaultSession.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) => requestingOrigin === state.origin && isPermissionAllowed(permission),
  );
}

/** Every page the app creates stays on the app's origin; links elsewhere go to the browser after a confirm. */
function guardNavigation(contents: WebContents): void {
  contents.on("will-navigate", (navigationEvent, targetUrl) => {
    const verdict = state.origin ? classifyNavigation(targetUrl, state.origin) : "blocked";
    if (verdict === "app") return;
    navigationEvent.preventDefault();
    if (verdict === "external") void confirmAndOpenExternal(BrowserWindow.fromWebContents(contents), targetUrl);
    else log(`blocked navigation to ${targetUrl}`);
  });
  contents.on("will-attach-webview", (attachEvent) => attachEvent.preventDefault());
  contents.setWindowOpenHandler(({ url: targetUrl }) => {
    const verdict = state.origin ? classifyNavigation(targetUrl, state.origin) : "blocked";
    if (verdict === "app" || targetUrl === "about:blank") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          backgroundColor: readCanvasColor(),
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
        },
      };
    }
    if (verdict === "external") void confirmAndOpenExternal(BrowserWindow.fromWebContents(contents), targetUrl);
    else log(`blocked window for ${targetUrl}`);
    return { action: "deny" };
  });
}

function createSplashWindow(): BrowserWindow {
  const splashWindow = new BrowserWindow({
    width: 360,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    center: true,
    backgroundColor: readCanvasColor(),
    title: PRODUCT_NAME,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  splashWindow.once("ready-to-show", () => splashWindow.show());
  void splashWindow.loadFile(path.join(__dirname, "splash.html"));
  return splashWindow;
}

function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) return;
  writeWindowState(windowStatePath, { ...window.getNormalBounds(), isMaximized: window.isMaximized() });
}

function createMainWindow(origin: string): BrowserWindow {
  const windowState = readWindowState(
    windowStatePath,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  const mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: readCanvasColor(),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--cmm-app-version=${app.getVersion()}`],
    },
  });
  state.mainWindow = mainWindow;
  if (windowState.isMaximized) mainWindow.maximize();
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    log(`window ready ${Date.now() - launchStartedAt} ms after launch`);
    if (state.splashWindow && !state.splashWindow.isDestroyed()) state.splashWindow.close();
    state.splashWindow = undefined;
  });
  mainWindow.on("close", () => saveWindowState(mainWindow));
  mainWindow.on("closed", () => {
    if (state.mainWindow === mainWindow) state.mainWindow = undefined;
  });
  void mainWindow.loadURL(`${origin}/`);
  return mainWindow;
}

/** Starts a server run: free port, fresh token, fork, health poll, launch cookie. Returns the origin. */
async function startServer(): Promise<string> {
  const port = await findFreePort();
  const launchToken = createLaunchToken();
  const origin = `http://127.0.0.1:${port}`;
  let isHealthy = false;
  const server = new DesktopServer({
    entryPath: serverEntryPath,
    environment: buildServerEnvironment(
      { port, launchToken, dataDirectory: userDataDirectory },
      process.env,
      process.platform,
    ),
    serverLog,
    // A server that dies while starting is reported by the startup error instead.
    onUnexpectedExit: (exitCode) => {
      if (isHealthy) void handleServerCrash(exitCode);
    },
  });
  state.server = server;
  log(`starting the server on ${origin} (${serverEntryPath})`);
  server.start();
  await waitForHealth(origin, launchToken, { signal: server.exitController.signal });
  isHealthy = true;
  await session.defaultSession.cookies.set({
    url: origin,
    name: "cmm_launch",
    value: launchToken,
    httpOnly: true,
    sameSite: "strict",
  });
  state.origin = origin;
  log(`server healthy ${Date.now() - launchStartedAt} ms after launch`);
  return origin;
}

/** The server died on its own: offer a restart or the logs, until the user picks one that ends it. */
async function handleServerCrash(exitCode: number): Promise<void> {
  if (state.isQuitting) return;
  log(`the server stopped unexpectedly (exit code ${exitCode})`);
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: "error",
      buttons: ["Restart CMM", "Open Logs", "Quit"],
      defaultId: 0,
      cancelId: 2,
      message: "CMM stopped unexpectedly.",
      detail: `The CMM server exited with code ${exitCode}. Running jobs resume where they stopped after a restart.`,
    });
    if (response === 1) {
      openLogsFolder();
      continue;
    }
    if (response === 2) {
      app.quit();
      return;
    }
    break;
  }
  try {
    const origin = await startServer();
    const { mainWindow } = state;
    if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(`${origin}/`);
    else createMainWindow(origin);
  } catch (restartError) {
    await showStartupError(restartError);
  }
}

async function showStartupError(startupError: unknown): Promise<void> {
  const message = startupError instanceof Error ? startupError.message : String(startupError);
  log(`startup failed: ${message}`);
  const { response } = await dialog.showMessageBox({
    type: "error",
    buttons: ["Open Logs", "Quit"],
    defaultId: 1,
    cancelId: 1,
    message: "CMM could not start.",
    detail: `${message}\n\nThe logs folder has the details.`,
  });
  if (response === 0) openLogsFolder();
  state.hasStoppedServer = true;
  await state.server?.stop(2000);
  app.quit();
}

async function launch(): Promise<void> {
  log(`CMM ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform}-${process.arch})`);
  hardenSession();
  registerDesktopIpc(() => state.origin, {
    onSetTheme: (theme) => {
      applyTheme(theme);
      saveThemePreference(themePath, theme);
      for (const window of BrowserWindow.getAllWindows()) window.setBackgroundColor(readCanvasColor());
    },
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildApplicationMenu({
        isMac,
        isDebug,
        onOpenGuide: openDesktopGuide,
        onOpenLogs: openLogsFolder,
        onResetCmm: () => void resetCmm(),
        onAbout: showAbout,
      }),
    ),
  );
  state.splashWindow = createSplashWindow();
  try {
    createMainWindow(await startServer());
  } catch (startupError) {
    if (state.splashWindow && !state.splashWindow.isDestroyed()) state.splashWindow.close();
    await showStartupError(startupError);
  }
}

if (app.requestSingleInstanceLock()) {
  app.on("second-instance", focusMainWindow);
  app.on("web-contents-created", (_createdEvent, contents) => guardNavigation(contents));
  app.on("activate", focusMainWindow);
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
  app.on("before-quit", (quitEvent) => {
    if (state.hasStoppedServer || !state.server?.isRunning) return;
    quitEvent.preventDefault();
    if (state.isQuitting) return;
    state.isQuitting = true;
    if (state.mainWindow) saveWindowState(state.mainWindow);
    log("quitting: asking the server to pause its jobs and stop");
    void state.server.stop().finally(() => {
      state.hasStoppedServer = true;
      log("server stopped, quitting");
      app.quit();
    });
  });
  void app.whenReady().then(launch);
} else {
  app.quit();
}
