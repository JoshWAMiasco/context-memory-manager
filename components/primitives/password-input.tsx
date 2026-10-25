"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { FormInputElement, type FormInputProps } from "@/components/primitives/form-input-element";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * A password field with a show/hide toggle on the right. `FormInput` renders it for every
 * `type="password"`, so the toggle appears on all password fields; use it directly only when you
 * need it outside `FormInput`. The button's name ("Show password" / "Hide password") comes from
 * screen-reader text rather than `aria-label`, so it never competes with the field's own label.
 *
 * @example
 * <PasswordInput id="current-password" autoComplete="current-password" />
 */
export function PasswordInput({ className, disabled, ...inputAttributes }: FormInputProps) {
  const [isVisible, setIsVisible] = useState(false);
  const toggleLabel = isVisible ? "Hide password" : "Show password";
  const ToggleIcon = isVisible ? EyeOff : Eye;
  return (
    <div className="relative w-full" data-password-visible={isVisible}>
      <FormInputElement
        {...inputAttributes}
        type={isVisible ? "text" : "password"}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className={mergeClassNames("pr-11", className)}
      />
      <button
        type="button"
        aria-pressed={isVisible}
        aria-controls={inputAttributes.id}
        title={toggleLabel}
        disabled={disabled}
        onClick={() => setIsVisible((wasVisible) => !wasVisible)}
        className="absolute inset-y-0 right-0 flex w-11 cursor-pointer items-center justify-center rounded-r-md text-foreground-subtle transition-colors hover:text-brand focus-visible:text-brand focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ToggleIcon className="h-4 w-4 stroke-[1.5]" aria-hidden="true" />
        <span className="sr-only">{toggleLabel}</span>
      </button>
    </div>
  );
}
