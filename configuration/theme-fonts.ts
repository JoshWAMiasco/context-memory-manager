import localFont from "next/font/local";

/** Oxanium, the display face for headings, brand and highlighted numbers (`font-display`). */
export const DISPLAY_FONT = localFont({
  variable: "--font-family-display",
  src: [{ path: "../styles/fonts/oxanium-latin-variable-weight.woff2", weight: "200 800", style: "normal" }],
  display: "swap",
});

/** Martian Mono, the body face for all other text (`font-body`, the default). */
export const BODY_FONT = localFont({
  variable: "--font-family-body",
  src: [{ path: "../styles/fonts/martian-mono-latin-variable-weight.woff2", weight: "100 800", style: "normal" }],
  display: "swap",
});

/**
 * The font variable classes the root layout puts on `<html>`. The font files are bundled in
 * styles/fonts, so the theme renders the same without an internet connection.
 *
 * @example
 * <html className={THEME_FONT_VARIABLE_CLASS_NAMES}>
 */
export const THEME_FONT_VARIABLE_CLASS_NAMES = `${DISPLAY_FONT.variable} ${BODY_FONT.variable}`;
