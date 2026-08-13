import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { sha256 } from '../common/crypto/sha256';

@Injectable()
export class AuthService {
    constructor(private readonly sessionsService: SessionsService,
        @InjectRepository(UserEntity)
        private readonly usersRepository: Repository<UserEntity>,
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
        const { refreshToken } = await this.sessionsService.create(user.id);
        const accessToken = this.createToken();
        return {
            refreshToken,
            accessToken,
        };
    }

    createToken(): string {
        return "";
    }
}
