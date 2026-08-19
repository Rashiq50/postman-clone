import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  passwordProblem,
} from '@postman-clone/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { NormalizeEmail } from './normalize-email';

/**
 * Delegates to the shared `passwordProblem` so the rule — and its wording —
 * lives in `@postman-clone/contracts` only. The frontend calls the same
 * function to pre-validate; this is the copy that actually enforces it.
 */
@ValidatorConstraint({ name: 'strongPassword', async: false })
class StrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && passwordProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return typeof args.value === 'string'
      ? (passwordProblem(args.value) ?? 'Password is not acceptable')
      : 'Password must be a string';
  }
}

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(EMAIL_MAX_LENGTH)
  @NormalizeEmail()
  email: string;

  /**
   * `@Validate` rather than `@MinLength` + `@Matches`: one constraint means
   * one message per attempt, so the form shows "must contain a number" instead
   * of a stack of overlapping complaints.
   *
   * Deliberately not trimmed. Leading and trailing spaces are legitimate
   * password characters, and silently stripping them here would lock the user
   * out at login, where the password is compared verbatim.
   */
  @Validate(StrongPasswordConstraint)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  /**
   * Trimmed *before* `@IsNotEmpty()` — transforms run first — so a name of
   * pure whitespace is a 400 rather than a blank display name in every header
   * the user ever sees.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;
}
