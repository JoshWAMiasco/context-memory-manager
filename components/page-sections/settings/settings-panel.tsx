import type { ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { Card } from "@/components/primitives/card";
import { mergeClassNames } from "@/utilities/merge-class-names";

export interface SettingsPanelProps {
  title: ReactNode;
  titleAddon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * The stacked card that holds one settings form: a title with a dashed divider, then the content.
 * `titleAddon` sits right after the title (for example a status badge).
 *
 * @example
 * <SettingsPanel title="Two-Factor Authentication (2FA)" titleAddon={<Badge tone="success">Enabled</Badge>}>
 *   <SecurityFields />
 *   <SettingsPanelFooter><Button type="submit">Save Changes</Button></SettingsPanelFooter>
 * </SettingsPanel>
 */
export function SettingsPanel({ title, titleAddon, className, children }: SettingsPanelProps) {
  return (
    <Card isStacked className={mergeClassNames("flex flex-col p-5", className)}>
      <h2 className="mb-6 flex items-center border-b border-dashed border-line-strong/70 pb-5 text-[0.94rem] font-medium">
        {title}
        {titleAddon}
      </h2>
      {children}
    </Card>
  );
}

/**
 * The action row at the bottom of a `SettingsPanel`, separated by a dashed line and aligned right
 * from the `md` breakpoint.
 *
 * @example
 * <SettingsPanelFooter>
 *   <SettingsSaveButton />
 * </SettingsPanelFooter>
 */
export function SettingsPanelFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={mergeClassNames("mt-6 flex flex-col-reverse gap-3 border-t border-dashed border-line-strong/70 pt-5 md:flex-row md:justify-end", className)}>{children}</div>;
}

/**
 * The outlined "Save Changes" submit button used at the bottom of settings forms.
 *
 * @example
 * <SettingsPanelFooter><SettingsSaveButton /></SettingsPanelFooter>
 */
export function SettingsSaveButton({ label = "Save Changes", className }: { label?: string; className?: string }) {
  return (
    <Button type="submit" variant="outline-primary" className={mergeClassNames("w-full border-primary/50 px-4 md:w-auto", className)}>
      {label}
    </Button>
  );
}
