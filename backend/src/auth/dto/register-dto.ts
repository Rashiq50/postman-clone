import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NormalizeEmail } from './normalize-email';

export class RegisterDto {
  // 320 is the maximum length of an addressable email address.
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  @NormalizeEmail()
  email: string;

  /**
   * Capped so a multi-megabyte body cannot be fed to Argon2 — registration
   * always hashes, and the route is public, so this bound matters even more
   * than LoginDto's.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(256)
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  name: string;
}
