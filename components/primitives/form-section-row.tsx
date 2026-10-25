import type { ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type FormSectionRowLabelWidth = "medium" | "large" | "half";

const LABEL_WIDTH_CLASS_NAMES: Record<FormSectionRowLabelWidth, string> = {
  medium: "xl:w-60",
  large: "xl:w-64",
  half: "xl:w-1/2",
};

export interface FormSectionRowProps {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  isRequired?: boolean;
  requiredLabel?: ReactNode;
  labelWidth?: FormSectionRowLabelWidth;
  className?: string;
  children: ReactNode;
}

/**
 * One row of a long settings-style form (add user, add product, account settings): the label with
 * an optional "Required" tag and a short description on the left, the control on the right. Below
 * the `xl` breakpoint the label column stacks above the control. Consecutive rows are spaced
 * automatically, so render them as siblings.
 *
 * @example
 * <FormSectionRow label="Email" htmlFor="email-address" isRequired description="Please provide a valid email address.">
 *   <FormInput id="email-address" name="emailAddress" type="email" />
 * </FormSectionRow>
 * <FormSectionRow label="Notifications" labelWidth="half" description="Choose how we contact you.">
 *   <FormSwitch label="Email updates" />
 * </FormSectionRow>
 */
export function FormSectionRow({ label, description, htmlFor, isRequired = false, requiredLabel = "Required", labelWidth = "medium", className, children }: FormSectionRowProps) {
  return (
    <div className={mergeClassNames("mt-5 block flex-col pt-5 first:mt-0 first:pt-0 sm:flex xl:flex-row xl:items-center", className)}>
      <div className={mergeClassNames("mb-2 inline-block sm:mr-5 sm:mb-0 sm:text-right xl:mr-14", LABEL_WIDTH_CLASS_NAMES[labelWidth])}>
        <div className="text-left">
          <div className="flex items-center">
            {htmlFor ? (
              <label htmlFor={htmlFor} className="font-medium">
                {label}
              </label>
            ) : (
              <div className="font-medium">{label}</div>
            )}
            {isRequired && (
              <div className="ml-2.5 rounded-md border border-line bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">{requiredLabel}</div>
            )}
          </div>
          {description && <div className="mt-1.5 text-xs leading-relaxed text-foreground-muted/80 xl:mt-3">{description}</div>}
        </div>
      </div>
      <div className="mt-3 w-full flex-1 xl:mt-0">{children}</div>
    </div>
  );
}
