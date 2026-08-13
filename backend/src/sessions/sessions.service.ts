import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import crypto from 'node:crypto';
import { Repository } from 'typeorm';
import { sha256 } from '../common/crypto/sha256';
import { SessionEntity } from './entities/session.entity';
import { UserEntity } from '../users/entities/user.entity';
@Injectable()
export class SessionsService {
    constructor(
        @InjectRepository(SessionEntity)
        private readonly sessionsRepository: Repository<SessionEntity>,
        private readonly configService: ConfigService,
        @InjectRepository(UserEntity)
        private readonly usersRepository: Repository<UserEntity>,
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

    async login(email: string, password: string): Promise<{
        session: SessionEntity;
        refreshToken: string;
    }> {
        const user = await this.usersRepository.findOne({ where: { email } });
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }
        if (user.passwordHash !== sha256(password)) {
            throw new UnauthorizedException('Invalid credentials');
        }
        return await this.create(user.id);
    }

    // findByRefreshToken(token: string)

    // rotate(sessionId: string, oldToken: string)

    // revoke(sessionId: string)

    // revokeAllForUser(userId: string)

    // deleteExpiredSessions()
}
