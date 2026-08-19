/**
 * The registration input policy, shared so the browser and the API cannot
 * disagree about it.
 *
 * A duplicated regex on the frontend is the classic way this drifts: the form
 * accepts what the API rejects (a confusing 400 with no field highlighted), or
 * refuses what the API would have taken. `RegisterDto` and `RegisterPage` both
 * call `passwordProblem` so there is exactly one rule.
 *
 * The client-side check is a *courtesy*, never a control. `RegisterDto` runs
 * the same function server-side, where it actually counts.
 */

/** 320 is the maximum length of an addressable email address. */
export const EMAIL_MAX_LENGTH = 320;

export const NAME_MAX_LENGTH = 100;

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Capped because every registration hashes with Argon2 on a public route, and
 * verification cost grows with input length — without a bound a handful of
 * multi-megabyte bodies can pin the CPU.
 */
export const PASSWORD_MAX_LENGTH = 256;

/**
 * The one problem worth telling the user about, or `null` if the password is
 * acceptable. Returning a message rather than a boolean keeps the wording in
 * one place too — the API's `details[].message` and the field hint under the
 * input are then guaranteed to say the same thing.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (!/[a-zA-Z]/.test(password)) {
    return 'Password must contain a letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain a number';
  }
  return null;
}
