/**
 * Icons CCM picks itself where the vscode-icons-js 11 mapping is older than the icon set: keyed by
 * lower-case extension (or whole file name), valued by icon file name.
 */
export const CCM_ICON_OVERRIDES: Readonly<Record<string, string>> = {
  csv: "file_type_csv.svg",
  tsv: "file_type_csv.svg",
  webp: "file_type_image.svg",
  avif: "file_type_image.svg",
  makefile: "file_type_text.svg",
};
