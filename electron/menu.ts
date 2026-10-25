/*
 * The application menu: the standard App, Edit and Window menus, View with reload, zoom
 * and full screen (DevTools only with `CMM_DEBUG=1`), and Help with the bundled Desktop Guide, the
 * logs folder, Reset CMM (a forgotten password) and About.
 */
import type { MenuItemConstructorOptions } from "electron";

export const MENU_ITEM_IDS = {
  desktopGuide: "desktop-guide",
  openLogs: "open-logs",
  resetCmm: "reset-cmm",
  about: "about-cmm",
  toggleDevTools: "toggle-devtools",
} as const;

export interface ApplicationMenuOptions {
  isMac: boolean;
  isDebug: boolean;
  onOpenGuide: () => void;
  onOpenLogs: () => void;
  onResetCmm: () => void;
  onAbout: () => void;
}

/**
 * The menu template; `Menu.buildFromTemplate` turns it into the menu.
 *
 * @example
 * Menu.setApplicationMenu(
 *   Menu.buildFromTemplate(buildApplicationMenu({ isMac, isDebug, onOpenGuide, onOpenLogs, onResetCmm, onAbout })),
 * );
 */
export function buildApplicationMenu({
  isMac,
  isDebug,
  onOpenGuide,
  onOpenLogs,
  onResetCmm,
  onAbout,
}: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const viewItems: MenuItemConstructorOptions[] = [
    { role: "reload" },
    { role: "forceReload" },
    { type: "separator" },
    { role: "resetZoom" },
    { role: "zoomIn" },
    { role: "zoomOut" },
    { type: "separator" },
    { role: "togglefullscreen" },
  ];
  if (isDebug) viewItems.push({ type: "separator" }, { id: MENU_ITEM_IDS.toggleDevTools, role: "toggleDevTools" });
  const helpItems: MenuItemConstructorOptions[] = [
    { id: MENU_ITEM_IDS.desktopGuide, label: "Desktop Guide (PDF)", click: onOpenGuide },
    { id: MENU_ITEM_IDS.openLogs, label: "Open Logs Folder", click: onOpenLogs },
    { type: "separator" },
    { id: MENU_ITEM_IDS.resetCmm, label: "Reset CMM…", click: onResetCmm },
  ];
  if (!isMac) helpItems.push({ type: "separator" }, { id: MENU_ITEM_IDS.about, label: "About CMM", click: onAbout });
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: "CMM",
      submenu: [
        { id: MENU_ITEM_IDS.about, label: "About CMM", click: onAbout },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({ label: "File", submenu: [{ role: "quit" }] });
  }
  template.push(
    { role: "editMenu" },
    { label: "View", submenu: viewItems },
    { role: "windowMenu" },
    { role: "help", submenu: helpItems },
  );
  return template;
}
