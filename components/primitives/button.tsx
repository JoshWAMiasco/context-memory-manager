import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "pending"
  | "danger"
  | "dark"
  | "facebook"
  | "twitter"
  | "instagram"
  | "linkedin"
  | "outline-primary"
  | "outline-secondary"
  | "outline-success"
  | "outline-warning"
  | "outline-pending"
  | "outline-danger"
  | "outline-dark"
  | "soft-primary"
  | "soft-secondary"
  | "soft-success"
  | "soft-warning"
  | "soft-pending"
  | "soft-danger"
  | "soft-dark";

export type ButtonSize = "small" | "medium" | "large";

const BUTTON_BASE_CLASS_NAMES =
  "transition duration-200 border shadow-xs inline-flex items-center justify-center py-2 px-3 rounded-md font-medium cursor-pointer focus:ring-4 focus:ring-primary/20 focus-visible:outline-hidden [&:not(button)]:text-center disabled:opacity-70 disabled:cursor-not-allowed";

const buttonVariantClassNames: Record<ButtonVariant, string> = {
  primary: "bg-primary border-primary text-on-primary [&:hover:not(:disabled)]:bg-primary/90 [&:hover:not(:disabled)]:border-primary/90",
  secondary:
    "bg-secondary/70 border-secondary/70 text-foreground [&:hover:not(:disabled)]:bg-surface-muted/90 [&:hover:not(:disabled)]:border-line/90",
  success: "bg-success border-success text-on-primary [&:hover:not(:disabled)]:bg-success/90 [&:hover:not(:disabled)]:border-success/90",
  warning: "bg-warning border-warning text-on-primary [&:hover:not(:disabled)]:bg-warning/90 [&:hover:not(:disabled)]:border-warning/90",
  pending: "bg-pending border-pending text-on-primary [&:hover:not(:disabled)]:bg-pending/90 [&:hover:not(:disabled)]:border-pending/90",
  danger: "bg-danger border-danger text-on-primary [&:hover:not(:disabled)]:bg-danger/90 [&:hover:not(:disabled)]:border-danger/90",
  dark: "bg-dark border-dark text-on-neutral [&:hover:not(:disabled)]:bg-dark/90 [&:hover:not(:disabled)]:border-dark/90",
  facebook: "bg-[#3b5998] border-[#3b5998] text-on-neutral [&:hover:not(:disabled)]:bg-[#3b5998]/90 [&:hover:not(:disabled)]:border-[#3b5998]/90",
  twitter: "bg-[#4ab3f4] border-[#4ab3f4] text-on-primary [&:hover:not(:disabled)]:bg-[#4ab3f4]/90 [&:hover:not(:disabled)]:border-[#4ab3f4]/90",
  instagram: "bg-[#517fa4] border-[#517fa4] text-on-primary [&:hover:not(:disabled)]:bg-[#517fa4]/90 [&:hover:not(:disabled)]:border-[#517fa4]/90",
  linkedin: "bg-[#0a66c2] border-[#0a66c2] text-on-neutral [&:hover:not(:disabled)]:bg-[#0a66c2]/90 [&:hover:not(:disabled)]:border-[#0a66c2]/90",
  "outline-primary": "border-primary text-primary [&:hover:not(:disabled)]:bg-primary/10 [&:hover:not(:disabled)]:border-primary/90",
  "outline-secondary":
    "border-secondary text-foreground [&:hover:not(:disabled)]:bg-secondary/20 [&:hover:not(:disabled)]:border-secondary/90",
  "outline-success": "border-success text-success [&:hover:not(:disabled)]:bg-success/10 [&:hover:not(:disabled)]:border-success/90",
  "outline-warning": "border-warning text-warning [&:hover:not(:disabled)]:bg-warning/10 [&:hover:not(:disabled)]:border-warning/90",
  "outline-pending": "border-pending text-pending [&:hover:not(:disabled)]:bg-pending/10 [&:hover:not(:disabled)]:border-pending/90",
  "outline-danger": "border-danger text-danger [&:hover:not(:disabled)]:bg-danger/10 [&:hover:not(:disabled)]:border-danger/90",
  "outline-dark": "border-line-strong text-foreground-strong [&:hover:not(:disabled)]:bg-dark/40 [&:hover:not(:disabled)]:border-line-strong/90",
  "soft-primary":
    "bg-primary/20 border-primary/5 text-primary [&:hover:not(:disabled)]:bg-primary/10 [&:hover:not(:disabled)]:border-primary/10",
  "soft-secondary":
    "bg-surface-heavy/20 border-secondary text-foreground [&:hover:not(:disabled)]:bg-surface-heavy/10",
  "soft-success": "bg-success/20 border-success/5 text-success [&:hover:not(:disabled)]:bg-success/10 [&:hover:not(:disabled)]:border-success/10",
  "soft-warning": "bg-warning/20 border-warning/5 text-warning [&:hover:not(:disabled)]:bg-warning/10 [&:hover:not(:disabled)]:border-warning/10",
  "soft-pending": "bg-pending/20 border-pending/5 text-pending [&:hover:not(:disabled)]:bg-pending/10 [&:hover:not(:disabled)]:border-pending/10",
  "soft-danger": "bg-danger/20 border-danger/5 text-danger [&:hover:not(:disabled)]:bg-danger/10 [&:hover:not(:disabled)]:border-danger/10",
  "soft-dark":
    "bg-dark/60 border-line text-foreground-strong [&:hover:not(:disabled)]:bg-dark/40 [&:hover:not(:disabled)]:border-line",
};

const buttonSizeClassNames: Record<ButtonSize, string> = {
  small: "text-xs py-1.5 px-2",
  medium: "",
  large: "text-lg py-1.5 px-4",
};

interface ButtonAppearanceProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isRounded?: boolean;
  isElevated?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export interface ButtonProps extends ButtonAppearanceProps, ComponentProps<"button"> {}

export interface ButtonLinkProps extends ButtonAppearanceProps, Omit<ComponentProps<typeof Link>, "children"> {
  children?: ReactNode;
}

/**
 * Returns the class names for a button appearance, for elements that should look like a
 * button but are neither `Button` nor `ButtonLink` (for example a `<label>` file picker).
 *
 * @example
 * <label className={createButtonClassNames({ variant: "outline-secondary", size: "small" })}>Browse</label>
 */
export function createButtonClassNames({
  variant,
  size = "medium",
  isRounded = false,
  isElevated = false,
  className,
}: ButtonAppearanceProps & { className?: string }): string {
  return mergeClassNames(
    BUTTON_BASE_CLASS_NAMES,
    variant && buttonVariantClassNames[variant],
    buttonSizeClassNames[size],
    isRounded && "rounded-full",
    isElevated && "shadow-md",
    className,
  );
}

/**
 * A button in one of 25 variants. Server component; pass `onClick` only from
 * client components, or use `type="submit"` inside a form with a server action.
 *
 * @example
 * <Button variant="primary">Save changes</Button>
 * <Button variant="outline-danger" size="small" isRounded leadingIcon={<Trash2 className="mr-2 h-4 w-4" />}>
 *   Delete
 * </Button>
 */
export function Button({ variant, size, isRounded, isElevated, leadingIcon, trailingIcon, className, children, type = "button", ...buttonAttributes }: ButtonProps) {
  return (
    <button type={type} className={createButtonClassNames({ variant, size, isRounded, isElevated, className })} {...buttonAttributes}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}

/**
 * A Next.js `Link` styled as a button. Use it for navigation instead of `Button` + `router.push`.
 *
 * @example
 * <ButtonLink href="/users/new" variant="primary" leadingIcon={<PenLine className="mr-2 h-4 w-4 stroke-[1.3]" />}>
 *   Add New User
 * </ButtonLink>
 */
export function ButtonLink({ variant, size, isRounded, isElevated, leadingIcon, trailingIcon, className, children, ...linkAttributes }: ButtonLinkProps) {
  return (
    <Link className={createButtonClassNames({ variant, size, isRounded, isElevated, className })} {...linkAttributes}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}
