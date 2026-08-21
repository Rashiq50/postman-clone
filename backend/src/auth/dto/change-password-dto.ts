import { PASSWORD_MAX_LENGTH } from '@raven/contracts';
import { IsNotEmpty, IsString, MaxLength, Validate } from 'class-validator';
import { StrongPasswordConstraint } from './strong-password';

/**
 * ⚠️ The two fields are validated asymmetrically on purpose.
 *
 * `newPassword` runs the shared policy. `currentPassword` runs none of it: it
 * is verified against the stored hash, and a policy check there would reject a
 * password that was legal when it was set but is not now — locking the user out
 * of the one screen that could replace it. Neither is ever trimmed; spaces are
 * legitimate password characters and login compares verbatim.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @Validate(StrongPasswordConstraint)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}
