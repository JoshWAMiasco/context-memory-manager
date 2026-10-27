import { defineConfig } from "@playwright/test";

/*
 * End-to-end tests of the real desktop app: `npm run test:e2e:desktop` launches the built Electron
 * app (`dist/electron` with the server in `dist/app`, from `npm run build:electron` and
 * `npm run build:web`) with Playwright. It runs against scratch data (CMM_DESKTOP_USER_DATA and
 * HOME under .cmm-test-data/electron/), never your own CMM data, and never touches the installed
 * app. A window opens on screen while it runs.
 */
export default defineConfig({
  testDir: "e2e-electron",
  outputDir: "test-results-electron",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-electron" }]],
});
