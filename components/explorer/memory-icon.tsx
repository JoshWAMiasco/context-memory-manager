import {
  BookOpen,
  Bot,
  Code,
  FlaskConical,
  FolderKanban,
  GraduationCap,
  Lightbulb,
  MessageSquare,
  NotebookPen,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { BrainIcon } from "@/components/icons/ccm-icons";
import { MEMORY_COLOR_VALUES, type MemoryColor, type MemoryIcon as MemoryIconName } from "@/lib/memory";
import { mergeClassNames } from "@/utilities/merge-class-names";

/** The default tint of memory folders; a memory's `color` overrides it. */
export const DEFAULT_MEMORY_COLOR = "#a78bfa";

/** The lucide icons a memory can use instead of the brain. */
export const MEMORY_ICON_COMPONENTS: Record<Exclude<MemoryIconName, "brain">, LucideIcon> = {
  bot: Bot,
  sparkles: Sparkles,
  "book-open": BookOpen,
  "notebook-pen": NotebookPen,
  lightbulb: Lightbulb,
  "user-round": UserRound,
  "folder-kanban": FolderKanban,
  "flask-conical": FlaskConical,
  code: Code,
  "message-square": MessageSquare,
  "graduation-cap": GraduationCap,
};

/**
 * The CSS colour of a memory colour name, or the default violet.
 *
 * @example
 * readMemoryColor("info"); // "var(--color-info)"
 */
export function readMemoryColor(color: MemoryColor | undefined): string {
  return color ? MEMORY_COLOR_VALUES[color] : DEFAULT_MEMORY_COLOR;
}

/**
 * The icon of a memory folder: the brain (Iconoir) or the memory's chosen lucide icon, tinted
 * with its colour.
 *
 * @example
 * <MemoryIcon icon="bot" color="info" />
 */
export function MemoryIcon({
  icon = "brain",
  color,
  className,
}: {
  isOpen?: boolean;
  icon?: MemoryIconName;
  color?: MemoryColor;
  className?: string;
}) {
  const iconClassName = mergeClassNames("h-4 w-4 flex-none", className);
  const style = { color: readMemoryColor(color) };
  if (icon === "brain") return <BrainIcon className={iconClassName} style={style} data-testid="memory-icon" />;
  const IconComponent = MEMORY_ICON_COMPONENTS[icon];
  return (
    <IconComponent
      className={mergeClassNames(iconClassName, "stroke-[1.75]")}
      style={style}
      data-testid="memory-icon"
    />
  );
}
