import type { ComponentProps } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";
import { formControlSizeClassNames, type FormControlSize } from "@/components/primitives/form-input";

const FORM_TEXTAREA_BASE_CLASS_NAMES =
  "disabled:bg-surface-muted disabled:cursor-not-allowed [&[readonly]]:bg-surface-muted [&[readonly]]:cursor-not-allowed transition duration-200 ease-in-out w-full text-sm bg-field text-foreground border-line-strong shadow-xs rounded-md placeholder:text-foreground-subtle/90 focus:ring-4 focus:ring-primary/20 focus:border-primary/40 group-[.form-inline]:flex-1 group-[.input-group]:rounded-none group-[.input-group]:[&:not(:first-child)]:border-l-transparent group-[.input-group]:first:rounded-l group-[.input-group]:last:rounded-r group-[.input-group]:z-10";

export interface FormTextareaProps extends ComponentProps<"textarea"> {
  size?: FormControlSize;
  hasError?: boolean;
}

/**
 * A multi-line text input in the theme's style.
 *
 * @example
 * <FormTextarea name="message" rows={4} placeholder="Type your message…" />
 */
export function FormTextarea({ size = "medium", hasError = false, className, ...textareaAttributes }: FormTextareaProps) {
  return (
    <textarea
      aria-invalid={hasError || undefined}
      className={mergeClassNames(FORM_TEXTAREA_BASE_CLASS_NAMES, formControlSizeClassNames[size], hasError && "border-danger", className)}
      {...textareaAttributes}
    />
  );
}
