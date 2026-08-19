import type { AuthResponse } from '@postman-clone/contracts';
import { Expose, Type, plainToInstance } from 'class-transformer';
import type { IssuedAuth } from '../auth.service';
import { AuthUserResponseDto } from './auth-user.dto';

/**
 * What login and refresh both return.
 *
 * The refresh token is deliberately absent: it travels only in the httpOnly
 * cookie, so no JavaScript on the page — including anything injected into it —
 * can read the long-lived credential.
 *
 * Returning `user` from *refresh* as well as login is also deliberate. Without
 * it every app boot would cost an extra `GET /auth/me` round trip and the
 * header would flicker between anonymous and signed-in.
 */
export class AuthResponseDto implements AuthResponse {
  @Expose()
  accessToken: string;

  @Expose()
  expiresIn: number;

  /**
   * ⚠️ The `@Type()` is load-bearing. Under `excludeExtraneousValues` a nested
   * `@Expose()`d property with no `@Type` is not transformed through the child
   * class's rules — you get a stripped object or an untransformed passthrough
   * of the raw entity, and the passthrough is how `passwordHash` reaches the
   * wire. `auth-response.dto.spec.ts` pins this.
   */
  @Expose()
  @Type(() => AuthUserResponseDto)
  user: AuthUserResponseDto;

  static from(issued: IssuedAuth): AuthResponseDto {
    return plainToInstance(AuthResponseDto, issued, {
      excludeExtraneousValues: true,
    });
  }
}
