import type { AuthUser } from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { UserEntity } from '../../users/entities/user.entity';

/**
 * The user as the client sees it. `@Expose()`-only and built with
 * `excludeExtraneousValues`, so `passwordHash` — and anything added to
 * `UserEntity` later — is dropped by default rather than leaking.
 */
export class AuthUserResponseDto implements AuthUser {
  @Expose()
  id: string;

  @Expose()
  email: string;

  @Expose()
  name: string;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  createdAt: string;

  static from(user: UserEntity): AuthUserResponseDto {
    return plainToInstance(AuthUserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
