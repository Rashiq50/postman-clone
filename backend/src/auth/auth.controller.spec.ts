import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { CookieOptions, Request, Response } from 'express';
import { UserEntity } from '../users/entities/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const COOKIE_NAME = 'pc_refresh_token';

function fakeRequest(overrides: {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  ip?: string;
}): Request {
  const headers = overrides.headers ?? {};
  return {
    cookies: overrides.cookies ?? {},
    ip: overrides.ip,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

function fakeResponse() {
  const cookie = jest.fn();
  const clearCookie = jest.fn();
  return {
    res: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    logoutAll: jest.Mock;
    me: jest.Mock;
  };

  const user = {
    id: 'user-1',
    email: 'seed@example.com',
    name: 'Seed User',
    passwordHash: '$argon2id$super-secret',
    createdAt: new Date('2026-08-19T10:00:00.000Z'),
  } as UserEntity;

  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const issued = {
    accessToken: 'access-token',
    expiresIn: 900,
    refreshToken: 'refresh-token',
    refreshExpiresAt,
    user,
  };

  beforeEach(async () => {
    authService = {
      login: jest.fn().mockResolvedValue(issued),
      refresh: jest
        .fn()
        .mockResolvedValue({ ...issued, refreshToken: 'rotated-token' }),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(undefined),
      me: jest.fn().mockResolvedValue(user),
    };

    const config: Record<string, unknown> = {
      AUTH_COOKIE_NAME: COOKIE_NAME,
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
      COOKIE_DOMAIN: '',
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
            getOrThrow: (key: string) => config[key],
          },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('login', () => {
    it('passes the credentials through and returns the access token and user', async () => {
      const { res } = fakeResponse();

      const result = await controller.login(
        { email: 'seed@example.com', password: 'Password123!' },
        fakeRequest({}),
        res,
      );

      expect(authService.login).toHaveBeenCalledWith(
        'seed@example.com',
        'Password123!',
        expect.anything(),
        undefined,
      );
      expect(result.accessToken).toBe('access-token');
      expect(result.expiresIn).toBe(900);
      expect(result.user.email).toBe('seed@example.com');
    });

    /**
     * The refresh token travels only in the httpOnly cookie. If it also
     * appeared in the body, any script on the page could read a 30-day
     * credential straight out of the login response and the cookie's httpOnly
     * flag would be worth nothing.
     */
    it('puts the refresh token in the cookie and never in the body', async () => {
      const { res, cookie } = fakeResponse();

      const result = await controller.login(
        { email: 'seed@example.com', password: 'Password123!' },
        fakeRequest({}),
        res,
      );

      expect(result).not.toHaveProperty('refreshToken');
      expect(JSON.stringify(result)).not.toContain('refresh-token');

      const [name, value, options] = cookie.mock.calls[0] as [
        string,
        string,
        CookieOptions,
      ];
      expect(name).toBe(COOKIE_NAME);
      expect(value).toBe('refresh-token');
      expect(options.httpOnly).toBe(true);
    });

    it('collects the device context from the request', async () => {
      const { res } = fakeResponse();

      await controller.login(
        { email: 'seed@example.com', password: 'Password123!' },
        fakeRequest({
          headers: { 'user-agent': 'Mozilla/5.0' },
          ip: '203.0.113.7',
        }),
        res,
      );

      expect(authService.login).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { userAgent: 'Mozilla/5.0', ipAddress: '203.0.113.7' },
        undefined,
      );
    });

    it('truncates an oversized user-agent to the column width', async () => {
      const { res } = fakeResponse();

      await controller.login(
        { email: 'seed@example.com', password: 'Password123!' },
        fakeRequest({ headers: { 'user-agent': 'x'.repeat(1000) } }),
        res,
      );

      const context = (authService.login.mock.calls[0] as unknown[])[2] as {
        userAgent: string;
      };
      expect(context.userAgent).toHaveLength(512);
    });

    // The same-browser orphan fix: the cookie slot is about to be overwritten,
    // so the session behind it has to be revoked rather than left as a ghost.
    it('hands the presented cookie to the service so its session is revoked', async () => {
      const { res } = fakeResponse();

      await controller.login(
        { email: 'seed@example.com', password: 'Password123!' },
        fakeRequest({ cookies: { [COOKIE_NAME]: 'old-cookie' } }),
        res,
      );

      expect(authService.login).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'old-cookie',
      );
    });
  });

  describe('refresh', () => {
    it('rotates the cookie and returns a fresh access token', async () => {
      const { res, cookie } = fakeResponse();

      const result = await controller.refresh(
        fakeRequest({ cookies: { [COOKIE_NAME]: 'presented-token' } }),
        res,
      );

      expect(authService.refresh).toHaveBeenCalledWith('presented-token');
      expect(result.accessToken).toBe('access-token');

      const [, value] = cookie.mock.calls[0] as [string, string];
      expect(value).toBe('rotated-token');
    });

    it('clears the cookie when the refresh fails', async () => {
      // A token that can only ever fail again should not stay in the browser —
      // and on reuse detection, re-presenting it keeps the incident alive.
      authService.refresh.mockRejectedValue(new Error('Invalid refresh token'));
      const { res, clearCookie } = fakeResponse();

      await expect(controller.refresh(fakeRequest({}), res)).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.anything());
    });
  });

  describe('logout', () => {
    it('revokes the presented cookie and clears it', async () => {
      const { res, clearCookie } = fakeResponse();

      await controller.logout(
        fakeRequest({ cookies: { [COOKIE_NAME]: 'presented-token' } }),
        res,
      );

      expect(authService.logout).toHaveBeenCalledWith('presented-token');
      expect(clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.anything());
    });

    // A protected logout would 401 exactly when a user most wants it to work —
    // a tab left open past the access token's lifetime.
    it('succeeds and still clears the cookie when none was presented', async () => {
      const { res, clearCookie } = fakeResponse();

      await expect(
        controller.logout(fakeRequest({}), res),
      ).resolves.toBeUndefined();
      expect(authService.logout).toHaveBeenCalledWith(undefined);
      expect(clearCookie).toHaveBeenCalled();
    });
  });

  describe('logout-all', () => {
    it('revokes every session for the verified user and clears the cookie', async () => {
      const { res, clearCookie } = fakeResponse();

      await controller.logoutAll(
        { userId: 'user-1', sessionId: 'session-1', tokenId: 'jti-1' },
        res,
      );

      expect(authService.logoutAll).toHaveBeenCalledWith('user-1');
      expect(clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.anything());
    });
  });

  describe('me', () => {
    it('returns the user from the verified token, without the password hash', async () => {
      const result = await controller.me({
        userId: 'user-1',
        sessionId: 'session-1',
        tokenId: 'jti-1',
      });

      expect(authService.me).toHaveBeenCalledWith('user-1');
      expect(result.email).toBe('seed@example.com');
      expect(result).not.toHaveProperty('passwordHash');
    });
  });
});
