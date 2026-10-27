import { defineConfig } from "@playwright/test";
import { DESKTOP, WEB } from "./e2e/support/environment";

/*
 * End-to-end tests against the built web server, never the Electron app: `npm run build:web`
 * (or `npm run build`), then `npm run test:e2e`. Two throwaway servers start on their own ports
 * and data folders (.cmm-test-data/): server mode for the "web" project, desktop mode for the
 * "desktop-mode" project (a browser with a faked desktop bridge). Tests share one server and run
 * one at a time, each in a folder of its own.
 */
export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./e2e/global-setup.ts",
  webServer: [WEB, DESKTOP].map((flavor) => ({
    command: `npx tsx e2e/support/start-server.ts ${flavor.name}`,
    url: `${flavor.baseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe" as const,
    stderr: "pipe" as const,
  })),
  use: {
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "web",
      testMatch: /.*\.web\.spec\.ts/,
      use: { baseURL: WEB.baseUrl, storageState: WEB.authFile },
    },
    {
      name: "desktop-mode",
      testMatch: /.*\.desktop\.spec\.ts/,
      use: { baseURL: DESKTOP.baseUrl, storageState: DESKTOP.authFile },
    },
  ],
});
