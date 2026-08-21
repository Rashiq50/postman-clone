import { HttpStatus, UnauthorizedException } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ApiErrorCode } from '@raven/contracts';
import { QueryFailedError } from 'typeorm';
import { ApiException } from '../common/errors/api.exception';
import { Test, TestingModule } from '@nestjs/testing';
import { hashPassword } from '../common/crypto/password';
import { SessionsService } from '../sessions/sessions.service';
import { UserEntity } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import type { JwtPayload } from './jwt-payload';

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ISSUER = 'postman-clone';
const AUDIENCE = 'postman-clone-api';

const PASSWORD = 'Password123!';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let usersService: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
  };
  let sessionsService: {
    create: jest.Mock;
    rotate: jest.Mock;
    revokeByRefreshToken: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let user: UserEntity;
  let refreshExpiresAt: Date;

  beforeEach(async () => {
    user = {
      id: 'user-1',
      email: 'seed@example.com',
      passwordHash: await hashPassword(PASSWORD),
    } as UserEntity;

    refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    usersService = {
      create: jest.fn().mockResolvedValue(user),
      findByEmail: jest.fn().mockResolvedValue(user),
      findById: jest.fn().mockResolvedValue(user),
    };
    sessionsService = {
      create: jest.fn().mockResolvedValue({
        session: { id: 'session-1' },
        refreshToken: 'refresh-token',
        expiresAt: refreshExpiresAt,
      }),
      rotate: jest.fn().mockResolvedValue({
        session: { id: 'session-1', userId: 'user-1' },
        refreshToken: 'rotated-token',
        expiresAt: refreshExpiresAt,
      }),
      revokeByRefreshToken: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      // The real JwtModule, mirroring auth.module.ts, so these tests assert the
      // token an actual client would receive rather than a stub's return value.
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: {
            algorithm: 'HS256',
            expiresIn: '15m',
            issuer: ISSUER,
            audience: AUDIENCE,
          },
        }),
      ],
      providers: [
        AuthService,
        { provide: SessionsService, useValue: sessionsService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createToken', () => {
    it('signs a verifiable token carrying the user and session', () => {
      const token = service.createToken('user-1', 'session-1');

      const payload = jwtService.verify<JwtPayload>(token, {
        secret: TEST_SECRET,
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      });

      expect(payload.sub).toBe('user-1');
      expect(payload.sid).toBe('session-1');
      expect(payload.jti).toEqual(expect.any(String));
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('uses HS256 and never "none"', () => {
      const [encodedHeader] = service.createToken('u', 's').split('.');
      const header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as { alg: string };

      expect(header.alg).toBe('HS256');
    });

    it('gives every token a distinct jti', () => {
      const decode = (token: string) =>
        jwtService.decode<JwtPayload>(token).jti;

      expect(decode(service.createToken('u', 's'))).not.toBe(
        decode(service.createToken('u', 's')),
      );
    });

    it('keeps sensitive and mutable user fields out of the payload', () => {
      const payload = jwtService.decode<JwtPayload & Record<string, unknown>>(
        service.createToken('user-1', 'session-1'),
      );

      expect(payload).not.toHaveProperty('email');
      expect(payload).not.toHaveProperty('passwordHash');
      expect(payload).not.toHaveProperty('name');
    });

    it('rejects a token whose payload was tampered with', () => {
      const [header, , signature] = service
        .createToken('user-1', 'session-1')
        .split('.');
      const forged = Buffer.from(
        JSON.stringify({ sub: 'admin', sid: 'session-1', jti: 'x' }),
      ).toString('base64url');

      expect(() => {
        jwtService.verify(`${header}.${forged}.${signature}`, {
          secret: TEST_SECRET,
        });
      }).toThrow();
    });
  });

  /**
   * `register` must stay shaped like `login`: same total `IssuedAuth` return,
   * same session-issuing tail, same same-browser revocation. Every past bug in
   * this pair came from one of them drifting, so these mirror the login tests
   * deliberately rather than testing registration in isolation.
   */
  describe('register', () => {
    const uniqueViolation = () =>
      Object.assign(
        new QueryFailedError('INSERT', [], new Error('duplicate key')),
        { driverError: { code: '23505' } },
      );

    it('creates the user and issues a session in one go', async () => {
      const result = await service.register(
        'new@example.com',
        'New User',
        PASSWORD,
      );

      expect(usersService.create).toHaveBeenCalledWith(
        'new@example.com',
        expect.stringContaining('$argon2id$'),
        'New User',
      );
      expect(sessionsService.create).toHaveBeenCalledWith(user.id, undefined);
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.refreshExpiresAt).toBe(refreshExpiresAt);
      expect(result.user).toBe(user);
    });

    // A handler that resolves `undefined` answers 200 with an empty body,
    // which a client reads as success. The return type must stay total.
    it('never resolves without an access token', async () => {
      const result = await service.register('new@example.com', 'N', PASSWORD);

      expect(result).toBeDefined();
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('stores an Argon2id hash, never the password itself', async () => {
      await service.register('new@example.com', 'New User', PASSWORD);

      const [, passwordHash] = usersService.create.mock.calls[0] as string[];
      expect(passwordHash).toMatch(/^\$argon2id\$/);
      expect(passwordHash).not.toContain(PASSWORD);
    });

    it('issues a token bound to the new user and session', async () => {
      const { accessToken } = await service.register(
        'new@example.com',
        'New User',
        PASSWORD,
      );

      const payload = jwtService.verify<JwtPayload>(accessToken, {
        secret: TEST_SECRET,
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      expect(payload.sub).toBe(user.id);
      expect(payload.sid).toBe('session-1');
    });

    it('passes the request context through to the new session', async () => {
      const context = { userAgent: 'jest', ipAddress: '127.0.0.1' };

      await service.register('new@example.com', 'N', PASSWORD, context);

      expect(sessionsService.create).toHaveBeenCalledWith(user.id, context);
    });

    it('turns the unique-index violation into EMAIL_TAKEN', async () => {
      usersService.create.mockRejectedValue(uniqueViolation());

      await expect(
        service.register('taken@example.com', 'N', PASSWORD),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: ApiErrorCode.EMAIL_TAKEN },
      });
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    // `UsersService.create` now wraps the insert and the personal-workspace
    // provisioning in one transaction. `manager.transaction` re-throws the
    // driver error untouched, so the mapping above still works and
    // `AuthService.register` needed no change — this pins that, because the
    // failure mode is a duplicate signup turning into a 500.
    it('still maps EMAIL_TAKEN when the 23505 is raised from inside the provisioning transaction', async () => {
      // Stands in for the real `manager.transaction`: run the callback, let it
      // fail, re-throw the driver error unchanged, roll the workspace back with
      // the user.
      usersService.create.mockImplementation(() =>
        Promise.reject(uniqueViolation()),
      );

      await expect(
        service.register('taken@example.com', 'N', PASSWORD),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: { code: ApiErrorCode.EMAIL_TAKEN },
      });
      // Nothing was minted, so there is no orphan session to go with the
      // rolled-back user and workspace.
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    // The duplicate check is the index, not a findByEmail — a pre-check races
    // under concurrent submits.
    it('does not pre-check the address with findByEmail', async () => {
      await service.register('new@example.com', 'N', PASSWORD);

      expect(usersService.findByEmail).not.toHaveBeenCalled();
    });

    it('lets an unexpected database error through as itself', async () => {
      const boom = new Error('connection lost');
      usersService.create.mockRejectedValue(boom);

      await expect(
        service.register('new@example.com', 'N', PASSWORD),
      ).rejects.toBe(boom);
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    describe('same-browser session revocation', () => {
      it('revokes the session behind the cookie the browser presented', async () => {
        await service.register(
          'new@example.com',
          'N',
          PASSWORD,
          undefined,
          'old-cookie',
        );

        expect(sessionsService.revokeByRefreshToken).toHaveBeenCalledWith(
          'old-cookie',
        );
      });

      // A registration that fails must not be able to kill a live session.
      it('does not revoke anything when the address is already taken', async () => {
        usersService.create.mockRejectedValue(uniqueViolation());

        await expect(
          service.register(
            'taken@example.com',
            'N',
            PASSWORD,
            undefined,
            'old-cookie',
          ),
        ).rejects.toBeInstanceOf(ApiException);

        expect(sessionsService.revokeByRefreshToken).not.toHaveBeenCalled();
      });
    });
  });

  describe('login', () => {
    it('returns the tokens, the user and the access token lifetime', async () => {
      const result = await service.login(user.email, PASSWORD);

      expect(result.refreshToken).toBe('refresh-token');
      expect(result.refreshExpiresAt).toBe(refreshExpiresAt);
      expect(result.user).toBe(user);
      expect(jwtService.decode<JwtPayload>(result.accessToken).sub).toBe(
        'user-1',
      );
    });

    // Derived from the token just signed rather than re-read from config, so
    // it cannot drift from the JwtModule factory.
    it('derives expiresIn from the signed token, not from config', async () => {
      const { accessToken, expiresIn } = await service.login(
        user.email,
        PASSWORD,
      );
      const { exp, iat } = jwtService.decode<JwtPayload>(accessToken);

      expect(expiresIn).toBe(exp - iat);
      expect(expiresIn).toBe(15 * 60);
    });

    it('passes the request context through to the new session', async () => {
      await service.login(user.email, PASSWORD, {
        userAgent: 'Mozilla/5.0',
        ipAddress: '203.0.113.7',
      });

      expect(sessionsService.create).toHaveBeenCalledWith('user-1', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '203.0.113.7',
      });
    });

    it('rejects a wrong password without creating a session', async () => {
      await expect(service.login(user.email, 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown email with the same message as a wrong password', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(
        service.login('nobody@example.com', PASSWORD),
      ).rejects.toThrow('Invalid credentials');
      expect(sessionsService.create).not.toHaveBeenCalled();
    });

    describe('same-browser session revocation', () => {
      it('revokes the session behind the cookie the browser presented', async () => {
        await service.login(user.email, PASSWORD, undefined, 'old-cookie');

        expect(sessionsService.revokeByRefreshToken).toHaveBeenCalledWith(
          'old-cookie',
        );
      });

      it('revokes the old session before issuing the new one', async () => {
        const order: string[] = [];
        sessionsService.revokeByRefreshToken.mockImplementation(() => {
          order.push('revoke');
          return Promise.resolve();
        });
        sessionsService.create.mockImplementation(() => {
          order.push('create');
          return Promise.resolve({
            session: { id: 'session-2' },
            refreshToken: 'refresh-token',
            expiresAt: refreshExpiresAt,
          });
        });

        await service.login(user.email, PASSWORD, undefined, 'old-cookie');

        expect(order).toEqual(['revoke', 'create']);
      });

      // An unauthenticated POST /auth/login must not be able to kill a session.
      it('does not revoke anything when the password is wrong', async () => {
        await expect(
          service.login(user.email, 'wrong', undefined, 'old-cookie'),
        ).rejects.toThrow(UnauthorizedException);

        expect(sessionsService.revokeByRefreshToken).not.toHaveBeenCalled();
      });
    });
  });

  describe('refresh', () => {
    it('rotates the token and re-issues an access token for the same session', async () => {
      const result = await service.refresh('presented-token');

      expect(sessionsService.rotate).toHaveBeenCalledWith('presented-token');
      expect(result.refreshToken).toBe('rotated-token');
      expect(result.user).toBe(user);

      const payload = jwtService.decode<JwtPayload>(result.accessToken);
      expect(payload.sub).toBe('user-1');
      // The stable session id is the whole point of the child-table design:
      // access tokens already in flight keep working across a rotation.
      expect(payload.sid).toBe('session-1');
    });

    it('rejects a missing cookie without touching the session store', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(sessionsService.rotate).not.toHaveBeenCalled();
    });

    it('rejects when the session outlived its user', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.refresh('presented-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('revokes the session behind the presented token', async () => {
      await service.logout('presented-token');

      expect(sessionsService.revokeByRefreshToken).toHaveBeenCalledWith(
        'presented-token',
      );
    });

    // A client calling logout has already decided the session is over; a
    // rejection here would leave the UI stuck signed in over nothing it can fix.
    it('resolves when no cookie was presented at all', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
    });
  });

  describe('logoutAll', () => {
    it('revokes every session the user has', async () => {
      await service.logoutAll('user-1');

      expect(sessionsService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('me', () => {
    it('returns the user behind a verified token', async () => {
      await expect(service.me('user-1')).resolves.toBe(user);
    });

    // 401, not 404: the token verified but its subject no longer exists, and
    // the caller's remedy is to log in again rather than to look elsewhere.
    it('is unauthorized, not not-found, when the user is gone', async () => {
      usersService.findById.mockResolvedValue(null);

      await expect(service.me('user-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
