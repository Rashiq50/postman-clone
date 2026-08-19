import { Transform } from 'class-transformer';

/**
 * Lowercases and trims an email before validation, so every auth entry point
 * agrees on the stored form. If register normalized while login did not, a
 * mixed-case registration could never log back in with the address the user
 * typed — `findByEmail` is an exact match.
 *
 * Non-strings pass through untouched: transforms run *before* validators, so
 * calling `.trim()` on a non-string body here would throw and surface as a
 * 500, where letting `@IsEmail()` reject it produces the normal 400
 * VALIDATION envelope.
 */
export const NormalizeEmail = (): PropertyDecorator =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
