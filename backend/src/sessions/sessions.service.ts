import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { sha256 } from '../common/crypto/sha256';
import { SessionEntity } from './entities/session.entity';
@Injectable()
export class SessionsService {
    constructor(
        @InjectRepository(SessionEntity)
        private readonly sessionsRepository: Repository<SessionEntity>,
        private readonly configService: ConfigService,
    ) { }

    // TODO: Implement the service methods

    async create(userId: string): Promise<{
        session: SessionEntity;
        refreshToken: string;
    }> {
        const refreshToken = crypto.randomBytes(32).toString('base64url');

        const refreshTokenHash = sha256(refreshToken);

        const expiresAt = new Date(
            Date.now() +
            parseInt(this.configService.getOrThrow<string>(
                'REFRESH_TOKEN_EXPIRES_IN',
            ).replace('d', '')) * 24 * 60 * 60 * 1000,
        );

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

    // findByRefreshToken(token: string)

    // rotate(sessionId: string, oldToken: string)

    // revoke(sessionId: string)

    // revokeAllForUser(userId: string)

    // deleteExpiredSessions()
}
