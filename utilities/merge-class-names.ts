import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const THEME_BACKGROUND_IMAGE_NAMES = ["texture-black", "texture-white", "chevron-white", "chevron-black", "file-icon-empty-directory", "file-icon-directory", "file-icon-file", "loading-puff"];

const mergeTailwindClasses = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "canvas",
        "surface",
        "surface-subtle",
        "surface-muted",
        "surface-strong",
        "surface-heavy",
        "foreground",
        "foreground-strong",
        "foreground-muted",
        "foreground-subtle",
        "foreground-faint",
        "field",
        "line",
        "line-strong",
        "on-primary",
        "on-neutral",
        "brand",
        "accent",
        "primary",
        "secondary",
        "success",
        "info",
        "warning",
        "pending",
        "danger",
        "light",
        "dark",
      ],
      radius: ["box"],
      shadow: ["box", "overlay", "glow", "glow-accent"],
      font: ["display", "body"],
    },
    classGroups: {
      "bg-image": [{ bg: THEME_BACKGROUND_IMAGE_NAMES }],
    },
  },
});

/**
 * Joins class names and resolves Tailwind conflicts so the last class wins.
 * Use it for every `className` that combines defaults with caller overrides.
 *
 * @example
 * mergeClassNames("px-3 py-2 bg-primary", isDisabled && "opacity-70", className);
 * // mergeClassNames("px-3", "px-5") → "px-5"
 */
export function mergeClassNames(...classNames: ClassValue[]): string {
  return mergeTailwindClasses(clsx(classNames));
}
