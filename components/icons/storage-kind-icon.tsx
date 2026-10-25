import { HardDrive } from "lucide-react";
import { ExternalDriveIcon, UsbFlashDiskIcon, type CcmIconProps } from "@/components/icons/ccm-icons";
import type { StorageKind } from "@/lib/api-types";

/**
 * The icon of a storage by kind: a hard drive for internal storages, an external drive for
 * external disks, a flash drive for USB sticks and cards.
 *
 * @example
 * <StorageKindIcon kind="usb" className="h-5 w-5" />
 */
export function StorageKindIcon({ kind, ...iconProps }: CcmIconProps & { kind: StorageKind }) {
  if (kind === "usb") return <UsbFlashDiskIcon data-storage-icon="usb" {...iconProps} />;
  if (kind === "external") return <ExternalDriveIcon data-storage-icon="external" {...iconProps} />;
  return <HardDrive data-storage-icon="internal" className={iconProps.className} aria-hidden="true" />;
}
