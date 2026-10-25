import type { ComponentProps } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";
import type { FormControlSize } from "@/components/primitives/form-input";

const FORM_SELECT_BASE_CLASS_NAMES =
  "disabled:bg-surface-muted disabled:cursor-not-allowed [&[readonly]]:bg-surface-muted [&[readonly]]:cursor-not-allowed transition duration-200 ease-in-out w-full bg-field text-foreground border-line-strong shadow-xs rounded-md px-3 pr-8 focus:ring-4 focus:ring-primary/20 focus:border-primary/40 group-[.form-inline]:flex-1";

const formSelectSizeClassNames: Record<FormControlSize, string> = {
  small: "text-xs py-1.5 pl-2",
  medium: "text-sm py-2",
  large: "text-lg py-1.5 pl-4",
};

export interface FormSelectOption {
  label: string;
  value: string;
  isDisabled?: boolean;
}

export interface FormSelectProps extends Omit<ComponentProps<"select">, "size"> {
  size?: FormControlSize;
  options?: readonly FormSelectOption[];
  hasError?: boolean;
}

/**
 * A native select in the theme's style. Pass `options`, or `<option>` children for full control.
 *
 * @example
 * <FormSelect name="department" defaultValue="engineering" options={[
 *   { label: "Engineering", value: "engineering" },
 *   { label: "Marketing", value: "marketing" },
 * ]} />
 */
export function FormSelect({ size = "medium", options, hasError = false, className, children, ...selectAttributes }: FormSelectProps) {
  return (
    <select
      aria-invalid={hasError || undefined}
      className={mergeClassNames(FORM_SELECT_BASE_CLASS_NAMES, formSelectSizeClassNames[size], hasError && "border-danger", className)}
      {...selectAttributes}
    >
      {options?.map((option) => (
        <option key={option.value} value={option.value} disabled={option.isDisabled}>
          {option.label}
        </option>
      ))}
      {children}
    </select>
  );
}
