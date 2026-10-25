"use client";

import { CheckCircle, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster, toast } from "sonner";
import { mergeClassNames } from "@/utilities/merge-class-names";

export type ToastNotificationTone = "success" | "error" | "warning" | "info";

export interface ToastNotificationOptions {
  title: ReactNode;
  description?: ReactNode;
  /** Picks the icon (when `icon` isn't given); errors also stay up longer. */
  tone?: ToastNotificationTone;
  icon?: ReactNode;
  actions?: ReactNode;
  durationInMilliseconds?: number;
  isSticky?: boolean;
  isDismissible?: boolean;
  className?: string;
}

export type ToastNotificationIdentifier = string | number;

const TONE_ICONS: Record<ToastNotificationTone, ReactNode> = {
  success: <CheckCircle className="h-5 w-5 flex-none stroke-[1] text-success" aria-hidden />,
  error: <CircleAlert className="h-5 w-5 flex-none stroke-[1] text-danger" aria-hidden />,
  warning: <TriangleAlert className="h-5 w-5 flex-none stroke-[1] text-warning" aria-hidden />,
  info: <Info className="h-5 w-5 flex-none stroke-[1] text-info" aria-hidden />,
};

/**
 * Shows a notification card in the top-right corner  and returns
 * its identifier, which `dismissToastNotification` accepts. Call it from client code, for example
 * after a form submits. Requires `ToastViewport` in the layout. Set `isDismissible={false}` to hide
 * the close button (pair it with `isSticky` only when you dismiss the toast yourself).
 *
 * @example
 * showToastNotification({
 *   title: "Message saved!",
 *   description: "The message will be sent in 5 minutes.",
 *   icon: <CheckCircle className="text-success" />,
 * });
 * const uploadToastIdentifier = showToastNotification({ title: "Uploading…", isSticky: true, isDismissible: false });
 * dismissToastNotification(uploadToastIdentifier);
 * showToastNotification({ title: "Couldn't rename", description: renameError.message, tone: "error" });
 */
export function showToastNotification({
  title,
  description,
  tone,
  icon = tone ? TONE_ICONS[tone] : undefined,
  actions,
  durationInMilliseconds = tone === "error" ? 6000 : 3000,
  isSticky = false,
  isDismissible = true,
  className,
}: ToastNotificationOptions): ToastNotificationIdentifier {
  return toast.custom(
    (toastIdentifier) => (
      <div className={mergeClassNames("box relative flex w-[350px] max-w-[calc(100vw-2rem)] rounded-lg py-5 pl-5 shadow-overlay", isDismissible ? "pr-14" : "pr-5", className)}>
        {icon}
        <div className={icon ? "ml-4 mr-4" : undefined}>
          <div className="font-medium">{title}</div>
          {description && <div className="mt-1 text-foreground-muted">{description}</div>}
          {actions && <div className="mt-2.5 flex font-medium">{actions}</div>}
        </div>
        {isDismissible && (
          <button type="button" aria-label="Close notification" onClick={() => toast.dismiss(toastIdentifier)} className="absolute top-0 right-0 mt-4 mr-4 cursor-pointer text-foreground-subtle hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
    { duration: isSticky ? Number.POSITIVE_INFINITY : durationInMilliseconds, dismissible: isDismissible, unstyled: true },
  );
}

/**
 * Closes a toast shown by `showToastNotification`, for example once the work it announced is done.
 * Without an identifier every open toast is closed.
 *
 * @example
 * const savingToastIdentifier = showToastNotification({ title: "Saving…", isSticky: true });
 * await saveDraft();
 * dismissToastNotification(savingToastIdentifier);
 */
export function dismissToastNotification(toastIdentifier?: ToastNotificationIdentifier) {
  toast.dismiss(toastIdentifier);
}

/**
 * The container that displays toast notifications. Render it once, in the root or dashboard layout.
 *
 * @example
 * <ToastViewport />
 */
export function ToastViewport() {
  return <Toaster position="top-right" expand gap={12} offset={20} />;
}
