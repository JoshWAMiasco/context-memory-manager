/*
 * electron-builder `afterSign` hook: notarizes the macOS app with Apple, but only when
 * APPLE_ID and APPLE_TEAM_ID are set (plus APPLE_APP_SPECIFIC_PASSWORD). Unsigned local builds and
 * the other platforms skip it. This is the one build step that talks to the network (Apple's
 * notary service); the app itself never does.
 */
const path = require("node:path");

exports.default = async function notarizeApp(context) {
  if (context.electronPlatformName !== "darwin") return;
  const { APPLE_ID, APPLE_TEAM_ID, APPLE_APP_SPECIFIC_PASSWORD } = process.env;
  if (!APPLE_ID || !APPLE_TEAM_ID) {
    console.log("  • notarization skipped (APPLE_ID and APPLE_TEAM_ID are not set)");
    return;
  }
  if (!APPLE_APP_SPECIFIC_PASSWORD) throw new Error("Notarization needs APPLE_APP_SPECIFIC_PASSWORD too.");
  // @electron/notarize ships with electron-builder (app-builder-lib depends on it).
  const notarizePath = require.resolve("@electron/notarize", { paths: [require.resolve("app-builder-lib")] });
  const { notarize } = require(notarizePath);
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • notarizing ${appPath}`);
  await notarize({
    appPath,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
