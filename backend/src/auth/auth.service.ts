import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { sha256 } from '../common/crypto/sha256';
import type { JwtPayload } from './jwt-payload';

@Injectable()
export class AuthService {
    constructor(private readonly sessionsService: SessionsService,
        @InjectRepository(UserEntity)
        private readonly usersRepository: Repository<UserEntity>,
        private readonly jwtService: JwtService,
    ) { }

    async login(email: string, password: string): Promise<{
        refreshToken: string;
        accessToken: string;
    }> {
        const user = await this.usersRepository.findOne({ where: { email } });
        if (!user) {
            throw new UnauthorizedException('Invalid credentials');
        }
        if (user.passwordHash !== sha256(password)) {
            throw new UnauthorizedException('Invalid credentials');
        }
        const { session, refreshToken } = await this.sessionsService.create(user.id);
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
