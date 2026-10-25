import type { FileEntry } from "@/lib/api-types";
import { iconForFile, iconForFolder } from "@/lib/icons/vscode-icon";
import { MemoryIcon } from "@/components/explorer/memory-icon";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * The 16px icon of a file or folder: vscode-icons by name, or the memory icon for memory folders.
 *
 * @example
 * <FileIcon entry={entry} isOpen={isExpanded} />
 */
export function FileIcon({
  entry,
  isOpen = false,
  className,
}: {
  entry: Pick<FileEntry, "name" | "type" | "badges">;
  isOpen?: boolean;
  className?: string;
}) {
  if (entry.type === "directory" && entry.badges.isMemory) {
    return (
      <MemoryIcon
        isOpen={isOpen}
        icon={entry.badges.memory?.icon}
        color={entry.badges.memory?.color}
        className={className}
      />
    );
  }
  const iconUrl = entry.type === "directory" ? iconForFolder(entry.name, isOpen) : iconForFile(entry.name);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      width={16}
      height={16}
      alt=""
      draggable={false}
      className={mergeClassNames("h-4 w-4 flex-none", className)}
    />
  );
}
