// This spec instantiates the DTO directly, without the Nest testing module
// that pulls `reflect-metadata` in for every other suite. class-transformer's
// @Type() decorator needs it at import time.
import 'reflect-metadata';
import type { IssuedAuth } from '../auth.service';
import { UserEntity } from '../../users/entities/user.entity';
import { AuthResponseDto } from './auth-response.dto';

describe('AuthResponseDto', () => {
  const createdAt = new Date('2026-08-19T10:00:00.000Z');

  const issued = (): IssuedAuth => ({
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt: new Date('2026-09-18T10:00:00.000Z'),
    user: {
      id: 'user-1',
      email: 'seed@example.com',
      name: 'Seed User',
      passwordHash: '$argon2id$super-secret',
      createdAt,
      updatedAt: createdAt,
    } as UserEntity,
  });

  it('exposes the access token, its lifetime and the user', () => {
    const dto = AuthResponseDto.from(issued());

    expect(dto.accessToken).toBe('access-token');
    expect(dto.expiresIn).toBe(900);
    expect(dto.user.id).toBe('user-1');
    expect(dto.user.email).toBe('seed@example.com');
    expect(dto.user.name).toBe('Seed User');
    expect(dto.user.createdAt).toBe('2026-08-19T10:00:00.000Z');
  });

  /**
   * Pins the `@Type(() => AuthUserResponseDto)` footgun. Under
   * `excludeExtraneousValues`, a nested `@Expose()`d property with no `@Type`
   * is not transformed through the child class's rules — the raw entity passes
   * through untouched, and `passwordHash` goes out on the wire. Removing that
   * decorator is the single change most likely to break the boundary while
   * every other assertion here still passes.
   */
  it('drops passwordHash from the nested user', () => {
    const dto = AuthResponseDto.from(issued());

    expect(dto.user).not.toHaveProperty('passwordHash');
    expect(dto.user).not.toHaveProperty('updatedAt');
    expect(JSON.stringify(dto)).not.toContain('argon2id');
  });

  it('never carries the refresh token — that travels only in the cookie', () => {
    const dto = AuthResponseDto.from(issued());

    expect(dto).not.toHaveProperty('refreshToken');
    expect(dto).not.toHaveProperty('refreshExpiresAt');
    expect(JSON.stringify(dto)).not.toContain('refresh-token');
  });
});
