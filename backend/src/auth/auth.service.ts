import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiErrorCode } from '@raven/contracts';
import { randomUUID } from 'node:crypto';
import { QueryFailedError } from 'typeorm';
import { hashPassword, verifyPassword } from '../common/crypto/password';
import { ApiException } from '../common/errors/api.exception';
import type { SessionContext } from '../sessions/sessions.service';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import type { JwtPayload } from './jwt-payload';

/**
 * A real Argon2id hash of a random string, verified against when no user
 * matches. Without it, a missing email returns in microseconds while a wrong
 * password takes the full hashing time, and that gap alone tells an attacker
 * which addresses are registered.
 *
 * This stays here rather than moving to `UsersService` with the lookups: it is
 * an authentication concern, and hiding it behind a user-lookup method is how
 * it quietly stops being applied.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$E3baNFDoelmbTljdGFnWZQ$M7/xjGIsJZVBdHr2Pd17WFm8Zhwqujo4uY0EQXort6Q';

/** Postgres unique-constraint violation, surfaced by TypeORM. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}

/**
 * What the controller needs to answer a login or refresh: the access token and
 * its lifetime for the body, the raw refresh token and its expiry for the
 * cookie, and the user to serialise.
 *
 * The raw refresh token is returned rather than written to a cookie here.
 * Cookies are HTTP plumbing, and keeping them out of the service is what lets
 * `auth.service.spec.ts` test the auth logic without faking a `Response`.
 */
export interface IssuedAuth {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: UserEntity;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionsService: SessionsService,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(
    email: string,
    name: string,
    password: string,
    context?: SessionContext,
    presentedRefreshToken?: string,
  ): Promise<IssuedAuth> {
    const passwordHash = await hashPassword(password);

    let user: UserEntity;
    try {
      user = await this.usersService.create(email, passwordHash, name);
    } catch (error) {
      // The unique index on users.email is the duplicate check. A
      // findByEmail-then-insert would race under concurrent submits; the
      // constraint cannot. The dedicated code (rather than plain CONFLICT) is
      // what lets the client say "email already in use" — an accepted
      // enumeration trade-off, documented in the README.
      if (isUniqueViolation(error)) {
        throw new ApiException(HttpStatus.CONFLICT, {
          code: ApiErrorCode.EMAIL_TAKEN,
          message: 'Email is already registered',
        });
      }
      throw error;
    }

    // Same reasoning as login below: the response is about to overwrite the
    // browser's single refresh-cookie slot, so the session behind the old
    // cookie must be revoked or it lives on as an unreachable ghost device.
    // Only after the user is created — a failed registration must not be able
    // to kill a session.
    await this.sessionsService.revokeByRefreshToken(presentedRefreshToken);

    const { session, refreshToken, expiresAt } =
      await this.sessionsService.create(user.id, context);

    return this.issue(user, session.id, refreshToken, expiresAt);
  }

  async login(
    email: string,
    password: string,
    context?: SessionContext,
    presentedRefreshToken?: string,
  ): Promise<IssuedAuth> {
    const user = await this.usersService.findByEmail(email);

    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // The refresh cookie is a single browser-wide slot, and this login is about
    // to overwrite it. Without this the session behind the old cookie would
    // never be revoked — its token merely becomes unreachable — so it would sit
    // live for its full lifetime as a ghost device in `GET /sessions` that the
    // user cannot recognise and whose "Revoke" does nothing observable.
    //
    // Precise: the only way to present that cookie is to *be* the browser being
    // overwritten, so other devices are untouched. Safe: the call is idempotent
    // and never throws, so a stale or foreign cookie cannot break a login.
    //
    // Only after the password check. An unauthenticated POST /auth/login must
    // not be able to kill a session.
    await this.sessionsService.revokeByRefreshToken(presentedRefreshToken);

    const { session, refreshToken, expiresAt } =
      await this.sessionsService.create(user.id, context);

    return this.issue(user, session.id, refreshToken, expiresAt);
  }

  /**
   * Rotates a refresh token and mints a fresh access token for the same
   * session. The session id is stable across rotation, so access tokens already
   * in flight keep working.
   */
  async refresh(rawRefreshToken: string | undefined): Promise<IssuedAuth> {
    if (!rawRefreshToken) {
      // Same message the rotation failures collapse to: a caller with no cookie
      // and a caller with a dead one learn exactly as much.
      throw new UnauthorizedException('Invalid refresh token');
    }

    const { session, refreshToken, expiresAt } =
      await this.sessionsService.rotate(rawRefreshToken);

    const user = await this.usersService.findById(session.userId);
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issue(user, session.id, refreshToken, expiresAt);
  }

  /**
   * Resolves on an absent or unknown token and never throws. Logout is the one
   * operation that must not be able to fail: a client calling it has already
   * decided the session is over, and a 4xx here would leave the UI stuck signed
   * in over something it cannot fix.
   */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    await this.sessionsService.revokeByRefreshToken(rawRefreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionsService.revokeAllForUser(userId);
  }

  /** `null` is a 401, not a 404: the token verified but its subject is gone. */
  async me(userId: string): Promise<UserEntity> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }
    return user;
  }

  /** Shared tail of `login` and `refresh` — both answer with the same shape. */
  private issue(
    user: UserEntity,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): IssuedAuth {
    const accessToken = this.createToken(user.id, sessionId);

    return {
      accessToken,
      expiresIn: this.expiresInSeconds(accessToken),
      refreshToken,
      refreshExpiresAt,
      user,
    };
  }

  /**
   * Seconds until the access token expires, read back off the token just
   * signed rather than from `JWT_ACCESS_EXPIRES_IN`. Re-reading the config here
   * would be a second copy of a signing parameter, which is exactly what
   * keeping those options in the `JwtModule` factory is meant to prevent — and
   * the two copies would drift the first time one of them changed.
   */
  private expiresInSeconds(accessToken: string): number {
    const { exp, iat } = this.jwtService.decode<JwtPayload>(accessToken);
    return exp - iat;
  }

  /**
   * Mints a short-lived access token for a user within a specific session.
   *
   * Algorithm, lifetime, issuer and audience come from the `JwtModule`
   * registration in `auth.module.ts` so they cannot drift per call site. Only
   * the identity claims are passed here.
   */
  createToken(userId: string, sessionId: string): string {
    const payload: Pick<JwtPayload, 'sub' | 'sid' | 'jti'> = {
      sub: userId,
      sid: sessionId,
      // A per-token id: lets a single leaked token be traced in logs and
      // denylisted later without invalidating the whole session.
      jti: randomUUID(),
    };

    return this.jwtService.sign(payload);
  }
}
