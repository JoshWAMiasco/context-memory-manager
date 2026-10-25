import type { ComponentProps } from "react";
import { FormInputElement, type FormInputProps } from "@/components/primitives/form-input-element";
import { PasswordInput } from "@/components/primitives/password-input";
import { mergeClassNames } from "@/utilities/merge-class-names";

export {
  formControlSizeClassNames,
  type FormControlSize,
  type FormInputProps,
} from "@/components/primitives/form-input-element";

/**
 * A text-like input (text, email, password, number, file, …) in the theme's style.
 * Works in plain forms and with react-hook-form's `register()`. Password fields
 * (`type="password"`) get a show/hide toggle everywhere they are used.
 *
 * @example
 * <FormInput type="email" name="emailAddress" placeholder="example@gmail.com" />
 * <FormInput type="password" autoComplete="current-password" />
 * <FormInput {...register("fullName")} hasError={Boolean(errors.fullName)} />
 */
export function FormInput(inputProperties: FormInputProps) {
  if (inputProperties.type === "password") return <PasswordInput {...inputProperties} />;
  return <FormInputElement {...inputProperties} />;
}

/**
 * Joins inputs and addons into one bordered row (`.input-group`).
 *
 * @example
 * <FormInputGroup>
 *   <FormInputAddon>@</FormInputAddon>
 *   <FormInput placeholder="Username" />
 * </FormInputGroup>
 */
export function FormInputGroup({ className, ...divisionAttributes }: ComponentProps<"div">) {
  return <div className={mergeClassNames("input-group group flex", className)} {...divisionAttributes} />;
}

/**
 * A text or icon segment inside `FormInputGroup`.
 *
 * @example
 * <FormInputAddon>.00</FormInputAddon>
 */
export function FormInputAddon({ className, ...divisionAttributes }: ComponentProps<"div">) {
  return (
    <div
      className={mergeClassNames(
        "border border-line bg-surface-muted px-3 py-2 text-foreground shadow-xs group-[.input-group]:rounded-none group-[.input-group]:first:rounded-l group-[.input-group]:last:rounded-r group-[.input-group]:[&:not(:first-child)]:border-l-transparent",
        className,
      )}
      {...divisionAttributes}
    />
  );
}
