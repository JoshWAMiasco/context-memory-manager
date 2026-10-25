import { AlertCircle } from "lucide-react";
import { StaticAlert } from "@/components/primitives/static-alert";
import { mergeClassNames } from "@/utilities/merge-class-names";

/**
 * A soft danger alert for a form's server-side error. Renders nothing without a message.
 *
 * @example
 * <FormErrorAlert message={errorMessage} className="mb-4" />
 */
export function FormErrorAlert({ message, className }: { message?: string; className?: string }) {
  if (!message) return null;
  return (
    <StaticAlert
      tone="danger"
      variant="soft"
      role="alert"
      data-testid="form-error"
      icon={<AlertCircle className="mr-2 h-4 w-4 shrink-0 stroke-[1.5]" />}
      className={mergeClassNames("flex items-center", className)}
    >
      {message}
    </StaticAlert>
  );
}
