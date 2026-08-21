import {
  EMAIL_MAX_LENGTH,
  NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
} from '@raven/contracts';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { NormalizeEmail } from './normalize-email';
import { StrongPasswordConstraint } from './strong-password';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(EMAIL_MAX_LENGTH)
  @NormalizeEmail()
  email: string;

  @Validate(StrongPasswordConstraint)
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name: string;
}
