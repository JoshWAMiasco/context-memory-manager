import type { Metadata } from "next";
import { connection } from "next/server";
import { THEME_FONT_VARIABLE_CLASS_NAMES } from "@/configuration/theme-fonts";
import { THEME_IDENTITY } from "@/configuration/theme-identity";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: { template: `%s · ${THEME_IDENTITY.themeDisplayName}`, default: THEME_IDENTITY.themeDisplayName },
  description: THEME_IDENTITY.productName,
  icons: { icon: { url: "/icons/cmm/logo.svg", type: "image/svg+xml" } },
};

/** Every page renders per request: the CSP nonce from `proxy.ts` only reaches dynamically rendered pages. */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className={`dark ${THEME_IDENTITY.themeName} ${THEME_FONT_VARIABLE_CLASS_NAMES}`}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
