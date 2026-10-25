import type { SVGProps } from "react";

export type CmmIconProps = SVGProps<SVGSVGElement>;

/**
 * USB flash drive, from MingCute Icon ("usb-flash-disk-line") by MingCute Design, Apache License 2.0.
 *
 * @example
 * <UsbFlashDiskIcon className="h-5 w-5" />
 */
export function UsbFlashDiskIcon(iconProps: CmmIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" {...iconProps}>
      <path
        fill="currentColor"
        d="M16 2a2 2 0 0 1 1.995 1.85L18 4v4h1a1 1 0 0 1 .993.883L20 9v7a5 5 0 0 1-4.783 4.995L15 21H9a5 5 0 0 1-4.995-4.783L4 16V9a1 1 0 0 1 .883-.993L5 8h1V4a2 2 0 0 1 1.85-1.995L8 2zm2 8H6v6a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3zm-2-6H8v4h8zm-5 1v2H9V5zm4 0v2h-2V5z"
      />
    </svg>
  );
}

/**
 * An external hard disk drive: a drive case with its platter, spindle arm and status light. Drawn
 * for CMM.
 *
 * @example
 * <ExternalDriveIcon className="h-5 w-5" />
 */
export function ExternalDriveIcon(iconProps: CmmIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...iconProps}
    >
      <rect x="4" y="2.75" width="16" height="18.5" rx="2" />
      <circle cx="12" cy="9.25" r="4" />
      <circle cx="12" cy="9.25" r="0.9" fill="currentColor" stroke="none" />
      <path d="M9.4 11.85 8 13.25" />
      <path d="M4 16.25h16" />
      <circle cx="16.75" cy="18.75" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * Safe eject: a shield with an arrow leaving it, so ejecting reads as "unplug safely". Drawn for
 * CMM.
 *
 * @example
 * <EjectShieldIcon className="h-4 w-4" />
 */
export function EjectShieldIcon(iconProps: CmmIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" {...iconProps}>
      <path
        d="M12 2.6c-.9 0-1.4 1.5-3.4 2.2-1.9.6-3.4-.1-4.3.5-.5.4-.5 1.1-.5 2.1 0 6.9 2.4 11.6 8.2 14 5.8-2.4 8.2-7.1 8.2-14 0-1 0-1.7-.5-2.1-.9-.6-2.4.1-4.3-.5C13.4 4.1 12.9 2.6 12 2.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        fill="currentColor"
        d="M6.81 17.37 L7.28 10.29 L9.88 12.89 L13.95 8.81 L16.08 10.94 L12.0 15.01 L14.6 17.49Z"
      />
      <path d="M15.75 7.05 L17.55 8.85" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A brain, marking memory folders. From Iconoir ("brain") by Luca Burgio, MIT License.
 *
 * @example
 * <BrainIcon className="h-4 w-4" style={{ color: memoryColor }} />
 */
export function BrainIcon(iconProps: CmmIconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" {...iconProps}>
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
        <path d="M7 14a3 3 0 1 0 1 5.83" />
        <path d="M4.264 15.605a4 4 0 0 1-.874-6.636m.03-.081A2.5 2.5 0 0 1 7 5.5m.238.065A2.5 2.5 0 1 1 12 4.5V20m-4 0a2 2 0 1 0 4 0m0-13a3 3 0 0 0 3 3m2 4a3 3 0 1 1-1 5.83" />
        <path d="M19.736 15.605a4 4 0 0 0 .874-6.636m-.03-.081A2.5 2.5 0 0 0 17 5.5m-5-1a2.5 2.5 0 1 1 4.762 1.065M16 20a2 2 0 1 1-4 0" />
      </g>
    </svg>
  );
}
