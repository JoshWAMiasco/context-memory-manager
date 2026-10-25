import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

const FORM_CHECK_INPUT_BASE_CLASS_NAMES =
  "transition-all duration-100 ease-in-out shadow-xs bg-field border-line-strong cursor-pointer focus:ring-4 focus:ring-offset-0 focus:ring-primary/20 [&[type='radio']]:checked:bg-primary [&[type='radio']]:checked:border-primary/10 [&[type='checkbox']]:checked:bg-primary [&[type='checkbox']]:checked:border-primary/10 [&:disabled:not(:checked)]:bg-surface-muted [&:disabled:not(:checked)]:cursor-not-allowed [&:disabled:checked]:opacity-70 [&:disabled:checked]:cursor-not-allowed";

const FORM_SWITCH_INPUT_CLASS_NAMES =
  "w-[38px] h-[24px] p-px rounded-full relative before:w-[20px] before:h-[20px] before:shadow-[1px_1px_3px_rgba(0,0,0,0.25)] before:transition-[margin-left] before:duration-200 before:ease-in-out before:absolute before:inset-y-0 before:my-auto before:rounded-full before:bg-foreground-subtle checked:bg-primary checked:border-primary checked:bg-none checked:before:ml-[14px] checked:before:bg-on-primary";

interface FormCheckBaseProps extends Omit<ComponentProps<"input">, "type"> {
  label?: ReactNode;
  description?: ReactNode;
  inputClassName?: string;
}

function FormCheckLayout({ inputElement, label, description, htmlFor, className }: { inputElement: ReactNode; label?: ReactNode; description?: ReactNode; htmlFor?: string; className?: string }) {
  if (!label && !description) return <>{inputElement}</>;
  return (
    <div className={mergeClassNames("flex items-center", description && "items-start", className)}>
      {inputElement}
      <div className="ml-2">
        {label && (
          <label htmlFor={htmlFor} className="cursor-pointer">
            {label}
          </label>
        )}
        {description && <div className="mt-0.5 text-xs text-foreground-muted">{description}</div>}
      </div>
    </div>
  );
}

/**
 * A checkbox with an optional label and description.
 *
 * @example
 * <FormCheckbox id="remember-me" name="rememberMe" label="Remember me" defaultChecked />
 */
export function FormCheckbox({ label, description, className, inputClassName, id, ...inputAttributes }: FormCheckBaseProps) {
  return (
    <FormCheckLayout
      htmlFor={id}
      label={label}
      description={description}
      className={className}
      inputElement={<input id={id} type="checkbox" className={mergeClassNames(FORM_CHECK_INPUT_BASE_CLASS_NAMES, "rounded-sm", inputClassName)} {...inputAttributes} />}
    />
  );
}

/**
 * A radio button with an optional label and description. Give radios in one group the same `name`.
 *
 * @example
 * <FormRadio id="plan-monthly" name="billingPlan" value="monthly" label="Monthly" defaultChecked />
 * <FormRadio id="plan-yearly" name="billingPlan" value="yearly" label="Yearly" />
 */
export function FormRadio({ label, description, className, inputClassName, id, ...inputAttributes }: FormCheckBaseProps) {
  return (
    <FormCheckLayout
      htmlFor={id}
      label={label}
      description={description}
      className={className}
      inputElement={<input id={id} type="radio" className={mergeClassNames(FORM_CHECK_INPUT_BASE_CLASS_NAMES, inputClassName)} {...inputAttributes} />}
    />
  );
}

/**
 * An on/off switch built on a native checkbox, so it submits with forms.
 *
 * @example
 * <FormSwitch id="email-notifications" name="isEmailNotificationEnabled" label="Email notifications" defaultChecked />
 */
export function FormSwitch({ label, description, className, inputClassName, id, ...inputAttributes }: FormCheckBaseProps) {
  return (
    <FormCheckLayout
      htmlFor={id}
      label={label}
      description={description}
      className={className}
      inputElement={<input id={id} type="checkbox" role="switch" className={mergeClassNames(FORM_CHECK_INPUT_BASE_CLASS_NAMES, FORM_SWITCH_INPUT_CLASS_NAMES, inputClassName)} {...inputAttributes} />}
    />
  );
}
