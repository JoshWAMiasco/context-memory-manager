import { measurePasswordStrength } from "@/lib/auth/policy";
import { mergeClassNames } from "@/utilities/merge-class-names";

const STRENGTH_SEGMENT_COUNT = 4;
const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong"];

/**
 * Four segments that fill as the password gains length, mixed case, digits and symbols (the same
 * look as a sign-up strength meter).
 *
 * @example
 * <PasswordStrengthMeter password={password} />
 */
export function PasswordStrengthMeter({ password, className }: { password: string; className?: string }) {
  const strengthScore = measurePasswordStrength(password);
  return (
    <div className={mergeClassNames("mt-3", className)}>
      <div
        className="grid h-1.5 w-full grid-cols-12 gap-4"
        role="meter"
        aria-label="Password strength"
        aria-valuemin={0}
        aria-valuemax={STRENGTH_SEGMENT_COUNT}
        aria-valuenow={strengthScore}
      >
        {Array.from({ length: STRENGTH_SEGMENT_COUNT }, (_unused, segmentIndex) => (
          <div
            key={segmentIndex}
            className={mergeClassNames(
              "col-span-3 h-full rounded-sm border border-line-strong/20 bg-foreground-subtle/30",
              segmentIndex < strengthScore && "border-brand/20 bg-brand/30",
            )}
          />
        ))}
      </div>
      <div className="mt-1.5 text-xs text-foreground-muted">{password ? STRENGTH_LABELS[strengthScore] : " "}</div>
    </div>
  );
}
