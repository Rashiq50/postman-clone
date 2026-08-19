import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { verifyPassword } from '../common/crypto/password';
import type { JwtPayload } from './jwt-payload';

/**
 * A real Argon2id hash of a random string, verified against when no user
 * matches. Without it, a missing email returns in microseconds while a wrong
 * password takes the full hashing time, and that gap alone tells an attacker
 * which addresses are registered.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,p=1,t=2$E3baNFDoelmbTljdGFnWZQ$M7/xjGIsJZVBdHr2Pd17WFm8Zhwqujo4uY0EQXort6Q';

@Injectable()
export class AuthService {
  constructor(
    private readonly sessionsService: SessionsService,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async login(
    email: string,
    password: string,
  ): Promise<{
    refreshToken: string;
    accessToken: string;
  }> {
    const user = await this.usersRepository.findOne({ where: { email } });

    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const { session, refreshToken } = await this.sessionsService.create(
      user.id,
    );
    const accessToken = this.createToken(user.id, session.id);
    return {
      refreshToken,
      accessToken,
    };
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
