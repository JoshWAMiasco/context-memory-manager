import { mergeClassNames } from "@/utilities/merge-class-names";

/** The tile's navy and the brand cyan, as in `public/icons/ccm/logo.svg` (the same drawing). */
const TILE_FILL = "#0d2233";
const BRAND = "#4cc9f0";
/** The cyan at 55% over the navy, opaque so the edge looks the same on any background. */
const TILE_BORDER = "#307e9b";

/**
 * CCM's logo: the left half of a brain whose circuit traces run into a hard drive (memory kept on
 * your own drives), on a navy tile. The same drawing as `public/icons/ccm/logo.svg`, which the app
 * icons, the splash window and the guide covers use; change both together. Decorative by default;
 * pass `title` when it is the only content of a link or button.
 *
 * @example
 * <CcmLogoMark className="h-[34px] w-[34px]" />
 */
export function CcmLogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={mergeClassNames("flex-none", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="1" y="1" width="62" height="62" rx="14" fill={TILE_FILL} stroke={TILE_BORDER} strokeWidth="1.5" />
      <path
        d="M29 16 C27 11.5 21 11 19.5 15 C15 13.5 11 17 12.5 21.5 C8.5 23.5 8 30 11.5 32 C8 35 9 41.5 13.5 42 C14 47 20 49.5 23 47 C25 50 28.5 50 29 48"
        fill="none"
        stroke={BRAND}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M29 22 H24 L21.5 19.5 M29 30 H18 M29 38 H24 L21.5 40.5"
        fill="none"
        stroke={BRAND}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="21" cy="19" r="2.3" fill={BRAND} />
      <circle cx="16.8" cy="30" r="2.3" fill={BRAND} />
      <circle cx="21" cy="41" r="2.3" fill={BRAND} />
      <rect x="27.5" y="11.5" width="28" height="41" rx="6" fill={BRAND} />
      <circle cx="41.5" cy="33" r="10" fill={TILE_FILL} />
      <circle cx="41.5" cy="33" r="5" fill="none" stroke={BRAND} strokeOpacity="0.45" strokeWidth="1.5" />
      <path d="M39.5 36 L48 23.5" stroke={BRAND} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="39.5" cy="36" r="2.8" fill={BRAND} />
      <circle cx="32" cy="16" r="1.4" fill={TILE_FILL} />
      <circle cx="51" cy="48" r="1.4" fill={TILE_FILL} />
    </svg>
  );
}
