import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [
    // AuthService still reads users through a repository directly; that moves
    // to UsersService separately.
    TypeOrmModule.forFeature([UserEntity]),
    /**
     * Import the module, never re-provide `SessionsService`. Nest caches module
     * instances, so importing `SessionsModule` from two places still yields one
     * service — but listing the *class* in `providers` here builds a second,
     * independent instance for this module's consumers. Two instances of a
     * session service is a correctness bug the moment one of them starts
     * carrying rotation state or opening transactions.
     */
    SessionsModule,
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
  providers: [
    AuthService,
    JwtAuthGuard,
    // Fail closed: every route in the application is authenticated unless it is
    // explicitly marked `@Public()`. `useExisting` rather than `useClass` so the
    // global guard and any explicit `@UseGuards(JwtAuthGuard)` share one
    // instance instead of each doing its own session lookup.
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
  ],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
