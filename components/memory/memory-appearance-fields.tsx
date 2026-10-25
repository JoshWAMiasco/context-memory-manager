"use client";

import { Check } from "lucide-react";
import { MemoryIcon } from "@/components/explorer/memory-icon";
import { FormLabel } from "@/components/primitives/form-field";
import {
  MEMORY_COLOR_VALUES,
  MEMORY_COLORS,
  MEMORY_ICONS,
  type MemoryColor,
  type MemoryIcon as MemoryIconName,
} from "@/lib/memory";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * The icon picker and colour swatches of a memory, shared by the New memory dialog and
 * the General tab of Folder settings.
 *
 * @example
 * <MemoryAppearanceFields icon={icon} color={color} onIconChange={setIcon} onColorChange={setColor} />
 */
export function MemoryAppearanceFields({
  icon,
  color,
  onIconChange,
  onColorChange,
  isDisabled = false,
}: {
  icon: MemoryIconName;
  color: MemoryColor;
  onIconChange: (icon: MemoryIconName) => void;
  onColorChange: (color: MemoryColor) => void;
  isDisabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <FormLabel id="memory-icon-label">Icon</FormLabel>
        <div role="radiogroup" aria-labelledby="memory-icon-label" className="mt-1 grid grid-cols-6 gap-1.5">
          {MEMORY_ICONS.map((iconName) => (
            <button
              key={iconName}
              type="button"
              role="radio"
              aria-checked={icon === iconName}
              aria-label={iconName.replaceAll("-", " ")}
              title={iconName.replaceAll("-", " ")}
              disabled={isDisabled}
              data-testid={`memory-icon-${iconName}`}
              onClick={() => onIconChange(iconName)}
              className={mergeClassNames(
                "flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-line hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50",
                icon === iconName && "border-brand bg-surface-strong",
              )}
            >
              <MemoryIcon icon={iconName} color={color} className="h-5 w-5" />
            </button>
          ))}
        </div>
      </div>
      <div>
        <FormLabel id="memory-color-label">Colour</FormLabel>
        <div role="radiogroup" aria-labelledby="memory-color-label" className="mt-1 flex flex-wrap gap-2">
          {MEMORY_COLORS.map((colorName) => (
            <button
              key={colorName}
              type="button"
              role="radio"
              aria-checked={color === colorName}
              aria-label={colorName}
              title={colorName}
              disabled={isDisabled}
              data-testid={`memory-color-${colorName}`}
              onClick={() => onColorChange(colorName)}
              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full ring-offset-2 ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 aria-checked:ring-2 aria-checked:ring-foreground"
              style={{ backgroundColor: MEMORY_COLOR_VALUES[colorName] }}
            >
              {color === colorName && <Check className="h-4 w-4 text-on-primary" />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
