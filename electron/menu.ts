/*
 * The application menu: the standard App, Edit and Window menus, View with reload, zoom
 * and full screen (DevTools only with `CCM_DEBUG=1`), and Help with the bundled Desktop Guide, the
 * logs folder, Reset CCM (a forgotten password) and About.
 */
import type { MenuItemConstructorOptions } from "electron";

export const MENU_ITEM_IDS = {
  desktopGuide: "desktop-guide",
  openLogs: "open-logs",
  resetCcm: "reset-ccm",
  about: "about-ccm",
  toggleDevTools: "toggle-devtools",
} as const;

export interface ApplicationMenuOptions {
  isMac: boolean;
  isDebug: boolean;
  onOpenGuide: () => void;
  onOpenLogs: () => void;
  onResetCcm: () => void;
  onAbout: () => void;
}

/**
 * The menu template; `Menu.buildFromTemplate` turns it into the menu.
 *
 * @example
 * Menu.setApplicationMenu(
 *   Menu.buildFromTemplate(buildApplicationMenu({ isMac, isDebug, onOpenGuide, onOpenLogs, onResetCcm, onAbout })),
 * );
 */
export function buildApplicationMenu({
  isMac,
  isDebug,
  onOpenGuide,
  onOpenLogs,
  onResetCcm,
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
    { id: MENU_ITEM_IDS.resetCcm, label: "Reset CCM…", click: onResetCcm },
  ];
  if (!isMac) helpItems.push({ type: "separator" }, { id: MENU_ITEM_IDS.about, label: "About CCM", click: onAbout });
  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: "CCM",
      submenu: [
        { id: MENU_ITEM_IDS.about, label: "About CCM", click: onAbout },
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
