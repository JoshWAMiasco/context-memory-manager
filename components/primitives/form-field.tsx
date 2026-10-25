import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * A form label. Inside `FormInlineField` it moves beside the control on small screens and up.
 *
 * @example
 * <FormLabel htmlFor="email-address">Email address</FormLabel>
 */
export function FormLabel({ className, ...labelAttributes }: ComponentProps<"label">) {
  return (
    <label
      className={mergeClassNames(
        "mb-2 inline-block group-[.form-inline]:mb-2 group-[.form-inline]:sm:mr-5 group-[.form-inline]:sm:mb-0 group-[.form-inline]:sm:text-right",
        className,
      )}
      {...labelAttributes}
    />
  );
}

/**
 * Small helper text shown under a control.
 *
 * @example
 * <FormHelpText>We'll never share your email with anyone else.</FormHelpText>
 */
export function FormHelpText({ className, ...divisionAttributes }: ComponentProps<"div">) {
  return <div className={mergeClassNames("mt-2 text-xs text-foreground-muted", className)} {...divisionAttributes} />;
}

/**
 * A validation error shown under a control. Renders nothing when `message` is empty.
 *
 * @example
 * <FormErrorMessage message={formState.errors.emailAddress?.message} />
 */
export function FormErrorMessage({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <div role="alert" className={mergeClassNames("mt-2 text-danger", className)}>
      {message}
    </div>
  );
}

export interface FormFieldProps {
  label?: ReactNode;
  htmlFor?: string;
  helpText?: ReactNode;
  errorMessage?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Stacks a label, a control, help text and an error message with the theme's spacing.
 *
 * @example
 * <FormField label="Full name" htmlFor="full-name" helpText="As shown on your ID." errorMessage={errors.fullName?.message}>
 *   <FormInput id="full-name" name="fullName" hasError={Boolean(errors.fullName)} />
 * </FormField>
 */
export function FormField({ label, htmlFor, helpText, errorMessage, className, children }: FormFieldProps) {
  return (
    <div className={className}>
      {label && <FormLabel htmlFor={htmlFor}>{label}</FormLabel>}
      {children}
      {helpText && <FormHelpText>{helpText}</FormHelpText>}
      <FormErrorMessage message={errorMessage} />
    </div>
  );
}

/**
 * Places a `FormLabel` beside its control from the `sm` breakpoint (`.form-inline`).
 *
 * @example
 * <FormInlineField>
 *   <FormLabel htmlFor="username" className="sm:w-20">Username</FormLabel>
 *   <FormInput id="username" />
 * </FormInlineField>
 */
export function FormInlineField({ className, ...divisionAttributes }: ComponentProps<"div">) {
  return <div className={mergeClassNames("form-inline group block items-center sm:flex", className)} {...divisionAttributes} />;
}
