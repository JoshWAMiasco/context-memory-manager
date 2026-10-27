import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  _electron as electron,
  expect,
  request as playwrightRequest,
  test as base,
  type APIRequestContext,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME, E2E_ROOT } from "../e2e/support/environment";

export { expect };

const ELECTRON_ROOT = path.join(E2E_ROOT, "electron");
const USER_DATA = path.join(ELECTRON_ROOT, "userdata");
/** The desktop app's "Home" storage is the home folder, so this scratch folder stands in for it. */
export const HOME = path.join(ELECTRON_ROOT, "home");
/** The id the desktop app gives its Home storage. */
export const HOME_STORAGE_ID = "home";

export interface DesktopApp {
  electronApp: ElectronApplication;
  /** The main window, signed in as the admin. */
  page: Page;
  /** `http://127.0.0.1:<port>` of the server the app started. */
  origin: string;
  port: number;
  userData: string;
  /** API calls with the app's own session and launch cookies, for setting things up quickly. */
  api: APIRequestContext;
  /** The cookie header of the app's session (launch cookie and session cookie). */
  cookieHeader: string;
}

/** A folder of the test's own in the Home storage, made before the test. */
export interface Workspace {
  name: string;
  path: (...segments: string[]) => string;
  disk: (...segments: string[]) => string;
  url: (desktop: DesktopApp, ...segments: string[]) => string;
  writeText: (relativePath: string, content?: string) => string;
  makeFolder: (relativePath: string) => string;
}

async function findMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const window = electronApp.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1"));
    if (window) return window;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The CMM window did not open.");
}

/** First run, the way a person does it: the setup wizard, then the sign-in page. */
async function setUpAndSignIn(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/setup/);
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Admin username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByLabel("Confirm password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create admin" }).click();
  await page.getByRole("link", { name: "Go to sign in" }).click();
  await page.getByLabel("Username").fill(ADMIN_USERNAME);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByTestId("drives-dashboard")).toBeVisible();
}

export const test = base.extend<{ workspace: Workspace }, { desktop: DesktopApp }>({
  desktop: [
    /* Playwright wants a destructured first argument even when a fixture needs nothing. */
    async ({}, use) => {
      rmSync(ELECTRON_ROOT, { recursive: true, force: true });
      mkdirSync(HOME, { recursive: true });
      mkdirSync(USER_DATA, { recursive: true });
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const electronApp = await electron.launch({
        args: [path.join(process.cwd(), "dist", "electron")],
        env: {
          ...environment,
          CMM_DESKTOP_USER_DATA: USER_DATA,
          HOME,
          USERPROFILE: HOME,
          NEXT_TELEMETRY_DISABLED: "1",
        },
      });
      try {
        const page = await findMainWindow(electronApp);
        await page.waitForLoadState("domcontentloaded");
        await setUpAndSignIn(page);
        const url = new URL(page.url());
        const cookies = await page.context().cookies(url.origin);
        const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
        const api = await playwrightRequest.newContext({
          baseURL: url.origin,
          extraHTTPHeaders: { cookie: cookieHeader },
        });
        await use({
          electronApp,
          page,
          origin: url.origin,
          port: Number(url.port),
          userData: USER_DATA,
          api,
          cookieHeader,
        });
        await api.dispose();
      } finally {
        await electronApp.close();
      }
    },
    { scope: "worker", timeout: 120_000 },
  ],

  workspace: async ({ desktop }, use) => {
    const name = `ws-${randomUUID().slice(0, 8)}`;
    const makeFolder = (relativePath: string) => {
      const folder = path.join(HOME, name, relativePath);
      mkdirSync(folder, { recursive: true });
      return folder;
    };
    makeFolder("");
    await use({
      name,
      path: (...segments) => [name, ...segments].join("/"),
      disk: (...segments) => path.join(HOME, name, ...segments),
      url: (app, ...segments) =>
        `${app.origin}/storage/${HOME_STORAGE_ID}/${[name, ...segments].map((segment) => encodeURIComponent(segment)).join("/")}`,
      writeText: (relativePath, content = `content of ${relativePath}\n`) => {
        makeFolder(path.dirname(relativePath));
        const file = path.join(HOME, name, relativePath);
        writeFileSync(file, content);
        return file;
      },
      makeFolder,
    });
    void desktop;
  },
});

export function treeRow(page: Page, storagePath: string) {
  return page.getByTestId(`tree-row-${storagePath}`);
}

export async function openRowMenu(page: Page, storagePath: string) {
  await treeRow(page, storagePath).click({ button: "right" });
  const menu = page.getByTestId("explorer-context-menu");
  await expect(menu).toBeVisible();
  return menu;
}
