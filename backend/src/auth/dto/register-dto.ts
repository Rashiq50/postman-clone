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
