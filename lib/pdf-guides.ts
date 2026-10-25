/*
 * The PDF guides that ship with CCM, shared by the docs route and Settings › About.
 * Isomorphic: no server-only imports here.
 */

export const PDF_GUIDES = {
  "desktop-guide": { fileName: "CCM-Desktop-Guide.pdf", title: "Desktop Guide" },
  "server-guide": { fileName: "CCM-Server-Guide.pdf", title: "Server Guide" },
} as const;

export type PdfGuideName = keyof typeof PDF_GUIDES;

/**
 * Whether `name` is one of the bundled guides.
 *
 * @example
 * if (!isPdfGuideName(name)) throw notFound();
 */
export function isPdfGuideName(name: string): name is PdfGuideName {
  return Object.hasOwn(PDF_GUIDES, name);
}
