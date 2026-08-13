import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { SessionsService } from '../sessions/sessions.service';
import { SessionEntity } from '../sessions/entities/session.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, SessionEntity]),
    /**
     * Signing options live here, not at each `sign()` call, so every access
     * token in the app is issued with the same algorithm, lifetime, issuer and
     * audience. `algorithm` is pinned explicitly: leaving it to the default
     * lets a verifier be talked into accepting a token it should reject.
     */
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256',
          // Validated as a `ms`-style duration by the Joi schema; the cast only
          // restores the literal type the library wants.
          expiresIn: config.getOrThrow<string>(
            'JWT_ACCESS_EXPIRES_IN',
          ) as JwtSignOptions['expiresIn'],
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: config.getOrThrow<string>('JWT_ISSUER'),
          audience: config.getOrThrow<string>('JWT_AUDIENCE'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionsService],
  exports: [JwtModule],
})
export class AuthModule { }
