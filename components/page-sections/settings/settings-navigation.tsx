import { Card } from "@/components/primitives/card";
import { SettingsNavigationLink } from "@/components/page-sections/settings/settings-navigation-link";
import type { SettingsNavigationItem } from "@/components/page-sections/settings/settings-navigation-items";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * The settings side navigation: a stacked card of icon links that highlights the current page.
 * Wrap it in a `sticky` container to keep it in view while the settings form scrolls.
 *
 * @example
 * <SettingsNavigation items={SETTINGS_NAVIGATION_ITEMS} className="sticky top-[104px]" />
 */
export function SettingsNavigation({
  items,
  className,
}: {
  items: readonly SettingsNavigationItem[];
  className?: string;
}) {
  return (
    <nav aria-label="Settings" className={mergeClassNames("block", className)}>
      <Card isStacked className="flex flex-col px-5 pt-5 pb-6">
        {items.map((item) => (
          <SettingsNavigationLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={<item.icon className="mr-3 h-4 w-4 stroke-[1.3]" />}
          />
        ))}
      </Card>
    </nav>
  );
}
