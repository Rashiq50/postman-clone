import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@raven/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { NormalizeEmail } from './normalize-email';

/**
 * A partial profile edit: the client sends only the fields it changed.
 *
 * ⚠️ `@NormalizeEmail()` is applied here too, and that is not decoration. It is
 * applied to `LoginDto` and `RegisterDto` for the same reason: `findByEmail` is
 * an exact match, so an address stored with different casing or a stray space
 * than the one the user later types is a **silent permanent lockout**. A profile
 * edit is the one place a user can change their address after the fact, which
 * makes this the easiest of the three to forget and the worst to get wrong.
 *
 * ⚠️ `currentPassword` carries no strength constraint — it is checked against
 * the stored hash, not against the policy. Validating it would reject a
 * correct password that predates a policy change, locking the user out of the
 * screen they would use to fix it. Only `MaxLength`, to bound the Argon2 input.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  @IsOptional()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(EMAIL_MAX_LENGTH)
  @NormalizeEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword?: string;
}
