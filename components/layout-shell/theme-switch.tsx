"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { announceError } from "@/components/explorer/explorer-context";
import { setThemePreference, useThemePreference } from "@/lib/client/theme";
import { THEME_LABELS, THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { mergeClassNames } from "@/utilities/merge-class-names";

const THEME_ICONS: Record<ThemePreference, LucideIcon> = { dark: Moon, light: Sun, system: Monitor };

/**
 * Dark, Light or System, as three buttons; the choice applies at once and is saved for the user.
 *
 * @example
 * <ThemeSwitch />
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const theme = useThemePreference();
  return (
    <div
      role="group"
      aria-label="Theme"
      className={mergeClassNames("flex rounded-md border border-line bg-field p-0.5", className)}
      data-testid="theme-switch"
    >
      {THEME_PREFERENCES.map((option) => {
        const OptionIcon = THEME_ICONS[option];
        return (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            onClick={(clickEvent) => {
              clickEvent.stopPropagation();
              setThemePreference(option).catch((saveError: unknown) =>
                announceError("Couldn't save the theme", saveError),
              );
            }}
            className={mergeClassNames(
              "flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
              theme === option
                ? "bg-surface-strong font-medium text-brand"
                : "text-foreground-muted hover:bg-surface-muted hover:text-foreground",
            )}
            data-testid={`theme-${option}`}
          >
            <OptionIcon className="h-3.5 w-3.5" aria-hidden />
            {THEME_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
