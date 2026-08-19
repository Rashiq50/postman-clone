import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import crypto from 'node:crypto';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { sha256 } from '../common/crypto/sha256';
import { parseDuration } from '../common/duration';
import { SessionEntity } from './entities/session.entity';

@Injectable()
export class SessionsService {
  /**
   * Resolved once, here, so a malformed REFRESH_TOKEN_EXPIRES_IN stops the
   * process at boot instead of surfacing on somebody's first login.
   */
  private readonly refreshTtlMs: number;

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionsRepository: Repository<SessionEntity>,
    private readonly configService: ConfigService,
  ) {
    this.refreshTtlMs = parseDuration(
      this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_IN'),
    );
  }

  // TODO: Implement the service methods

  async create(userId: string): Promise<{
    session: SessionEntity;
    refreshToken: string;
  }> {
    const refreshToken = crypto.randomBytes(32).toString('base64url');

    const refreshTokenHash = sha256(refreshToken);

    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    const session = this.sessionsRepository.create({
      user: { id: userId },
      refreshTokenHash,
      expiresAt,
    });

    await this.sessionsRepository.save(session);

    return {
      session,
      refreshToken,
    };
  }

  /**
   * Whether `sessionId` may still authenticate a request: it exists, was not
   * revoked, and has not expired.
   *
   * Both conditions are evaluated in SQL against the current time rather than
   * read into memory and compared, so a session cannot be considered live on
   * the strength of a stale row this process loaded earlier.
   */
  async isActive(sessionId: string): Promise<boolean> {
    const count = await this.sessionsRepository.count({
      where: {
        id: sessionId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    return count > 0;
  }

  // findByRefreshToken(token: string)

  // rotate(sessionId: string, oldToken: string)

  // revoke(sessionId: string)

  // revokeAllForUser(userId: string)

  // deleteExpiredSessions()
}
