const FILE_SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Formats a byte count the way the file manager shows it ("150 KB", "2.5 MB", "112 GB").
 *
 * @example
 * formatFileSize(2.5 * 1024 * 1024); // "2.5 MB"
 */
export function formatFileSize(sizeInBytes: number): string {
  let unitIndex = 0;
  let size = sizeInBytes;
  while (size >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${Number(size.toFixed(1))} ${FILE_SIZE_UNITS[unitIndex]}`;
}
