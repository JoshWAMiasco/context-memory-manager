import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USERNAME, DESKTOP, LAUNCH_TOKEN, WEB, type ServerFlavor } from "./support/environment";

/*
 * Creates the first admin on each server the way a person would on first run (the setup code for
 * a server, nothing for the desktop), signs in, and saves the session as `auth.json` for the
 * tests. The desktop-mode browser also carries the launch cookie the Electron shell would set.
 */

async function signInAndSaveSession(flavor: ServerFlavor): Promise<void> {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: flavor.baseUrl });
  try {
    if (flavor.mode === "desktop") {
      await context.addCookies([{ name: "cmm_launch", value: LAUNCH_TOKEN, url: flavor.baseUrl }]);
    }
    const setupBody: Record<string, string> = { username: ADMIN_USERNAME, password: ADMIN_PASSWORD };
    if (flavor.mode === "server") {
      setupBody.setupCode = readFileSync(path.join(flavor.dataDirectory, "setup-code"), "utf8").trim();
    }
    const setup = await context.request.post("/api/setup", { data: setupBody });
    if (setup.status() !== 201)
      throw new Error(`Setup on ${flavor.name} failed: ${setup.status()} ${await setup.text()}`);
    const login = await context.request.post("/api/auth/login", {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });
    if (!login.ok()) throw new Error(`Sign-in on ${flavor.name} failed: ${login.status()} ${await login.text()}`);
    await context.storageState({ path: flavor.authFile });
  } finally {
    await browser.close();
  }
}

export default async function globalSetup(): Promise<void> {
  await signInAndSaveSession(WEB);
  await signInAndSaveSession(DESKTOP);
}
