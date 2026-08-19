import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from './normalize-email';

export class LoginDto {
  // 320 is the maximum length of an addressable email address.
  // Normalized identically to RegisterDto, or mixed-case registrations could
  // never log back in.
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  @NormalizeEmail()
  email: string;

  /**
   * Capped so a multi-megabyte body cannot be fed to Argon2. Verification cost
   * grows with input length, and the route is public and unauthenticated, so
   * without a limit a handful of requests can pin the CPU.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}
