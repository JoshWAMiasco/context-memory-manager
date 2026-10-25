/**
 * The taller, softer input style used on the sign-in and sign-up forms.
 *
 * @example
 * <ValidatedInputField fieldName="emailAddress" label="Email*" inputClassName={AUTHENTICATION_INPUT_CLASS_NAMES} />
 */
export const AUTHENTICATION_INPUT_CLASS_NAMES = "block rounded-box border-line-strong/80 px-4 py-3.5";

/**
 * Class names for the full-width rounded gradient submit button on the authentication forms.
 *
 * @example
 * <Button type="submit" variant="primary" isRounded className={AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES}>Sign In</Button>
 */
export const AUTHENTICATION_SUBMIT_BUTTON_CLASS_NAMES = "w-full bg-linear-to-r from-brand/70 to-accent/70 py-3.5 xl:mr-3";

/**
 * Class names for the full-width secondary link button under the submit button.
 *
 * @example
 * <ButtonLink href="/register" variant="outline-secondary" isRounded className={AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES}>Sign Up</ButtonLink>
 */
export const AUTHENTICATION_SECONDARY_BUTTON_CLASS_NAMES = "mt-3 w-full bg-on-primary/70 py-3.5";
