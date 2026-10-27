import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { THEME_FONT_VARIABLE_CLASS_NAMES } from "@/configuration/theme-fonts";
import { THEME_IDENTITY } from "@/configuration/theme-identity";
import { THEME_COOKIE_NAME } from "@/lib/theme";
import { SESSION_COOKIE_NAME } from "@/server/auth/session";
import { readPageTheme } from "@/server/auth/theme";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { template: `%s · ${THEME_IDENTITY.themeDisplayName}`, default: THEME_IDENTITY.themeDisplayName },
  description: THEME_IDENTITY.productName,
  icons: { icon: { url: "/icons/cmm/logo.svg", type: "image/svg+xml" } },
};

/**
 * On phones the page shrinks above the on-screen keyboard (`dvh` follows it), so the terminal's
 * key bar and the line being typed stay in view rather than under the keyboard.
 */
export const viewport: Viewport = { width: "device-width", initialScale: 1, interactiveWidget: "resizes-content" };

/**
 * Every page renders per request: the CSP nonce from `proxy.ts` only reaches dynamically rendered
 * pages. `<html data-theme>` is the user's theme (Dark, Light or System) from the start, so a light
 * page never flashes dark.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  const cookieStore = await cookies();
  const theme = readPageTheme(cookieStore.get(THEME_COOKIE_NAME)?.value, cookieStore.get(SESSION_COOKIE_NAME)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${THEME_IDENTITY.themeName} ${THEME_FONT_VARIABLE_CLASS_NAMES}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
