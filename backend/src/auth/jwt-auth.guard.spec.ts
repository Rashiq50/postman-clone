import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionsService } from '../sessions/sessions.service';
import type { AuthenticatedRequest } from './authenticated-user';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';

const TEST_SECRET = 'test-secret-that-is-at-least-32-characters-long';
const ISSUER = 'postman-clone';
const AUDIENCE = 'postman-clone-api';

/** Mirrors the JwtModule registration in auth.module.ts. */
const jwtOptions = {
  secret: TEST_SECRET,
  signOptions: {
    algorithm: 'HS256' as const,
    expiresIn: '15m' as const,
    issuer: ISSUER,
    audience: AUDIENCE,
  },
  verifyOptions: {
    algorithms: ['HS256' as const],
    issuer: ISSUER,
    audience: AUDIENCE,
  },
};

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: JwtService;
  let sessionsService: { isActive: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  /** A request carrying `authorization`, shaped like the bits the guard uses. */
  const contextWith = (authorization?: string) => {
    const request = {
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? authorization : undefined,
    } as unknown as AuthenticatedRequest;

    return {
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => jest.fn(),
        getClass: () => jest.fn(),
      } as unknown as ExecutionContext,
      request,
    };
  };

  beforeEach(async () => {
    sessionsService = { isActive: jest.fn().mockResolvedValue(true) };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };

    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register(jwtOptions)],
      providers: [
        JwtAuthGuard,
        { provide: SessionsService, useValue: sessionsService },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = module.get(JwtAuthGuard);
    jwtService = module.get(JwtService);
  });

  it('accepts a valid token and attaches the signed identity', async () => {
    const token = jwtService.sign({
      sub: 'user-1',
      sid: 'session-1',
      jti: 'token-1',
    });
    const { context, request } = contextWith(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      tokenId: 'token-1',
    });
  });

  it.each([
    ['no Authorization header', undefined],
    ['an empty header', ''],
    ['a Basic credential', 'Basic dXNlcjpwYXNz'],
    ['a bare token with no scheme', 'sometoken'],
  ])('rejects %s', async (_label, header) => {
    await expect(
      guard.canActivate(contextWith(header).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different secret', async () => {
    const foreign = new JwtService({
      ...jwtOptions,
      secret: 'a-completely-different-secret-32-characters',
    });
    const token = foreign.sign({ sub: 'user-1', sid: 's', jti: 'j' });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const token = jwtService.sign(
      { sub: 'user-1', sid: 's', jti: 'j' },
      { expiresIn: '-1s' },
    );

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token from another issuer or audience', async () => {
    const other = new JwtService({
      ...jwtOptions,
      signOptions: { ...jwtOptions.signOptions, issuer: 'someone-else' },
    });
    const token = other.sign({ sub: 'user-1', sid: 's', jti: 'j' });

    await expect(
      guard.canActivate(contextWith(`Bearer ${token}`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: 'admin', sid: 's', jti: 'j' }),
    ).toString('base64url');

    await expect(
      guard.canActivate(contextWith(`Bearer ${header}.${payload}.`).context),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('gives the same message whatever the token defect, leaking no detail', async () => {
    const expired = jwtService.sign(
      { sub: 'u', sid: 's', jti: 'j' },
      { expiresIn: '-1s' },
    );
    const messageFor = async (header: string) => {
      try {
        await guard.canActivate(contextWith(header).context);
        return null;
      } catch (error) {
        return (error as UnauthorizedException).message;
      }
    };

    await expect(messageFor(`Bearer ${expired}`)).resolves.toBe(
      'Invalid access token',
    );
    await expect(messageFor('Bearer not-a-jwt')).resolves.toBe(
      'Invalid access token',
    );
  });

  describe('session revocation', () => {
    const validToken = () =>
      new JwtService(jwtOptions).sign({
        sub: 'user-1',
        sid: 'session-1',
        jti: 'token-1',
      });

    it('checks the session named by the token, not one supplied elsewhere', async () => {
      await guard.canActivate(contextWith(`Bearer ${validToken()}`).context);

      expect(sessionsService.isActive).toHaveBeenCalledWith('session-1');
    });

    it('rejects a signed, unexpired token whose session was revoked', async () => {
      sessionsService.isActive.mockResolvedValue(false);
      const { context, request } = contextWith(`Bearer ${validToken()}`);

      await expect(guard.canActivate(context)).rejects.toThrow(
        'Session is no longer active',
      );
      expect(request.user).toBeUndefined();
    });

    it('does not hit the database for a token that never verified', async () => {
      await expect(
        guard.canActivate(contextWith('Bearer not-a-jwt').context),
      ).rejects.toThrow(UnauthorizedException);
      expect(sessionsService.isActive).not.toHaveBeenCalled();
    });
  });

  describe('@Public()', () => {
    it('lets a marked route through with no token and no session lookup', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      await expect(
        guard.canActivate(contextWith(undefined).context),
      ).resolves.toBe(true);
      expect(sessionsService.isActive).not.toHaveBeenCalled();
    });

    it('reads the flag from the handler before the controller', async () => {
      await guard.canActivate(contextWith(`Bearer ${jwtService.sign({
        sub: 'u',
        sid: 's',
        jti: 'j',
      })}`).context);

      const [key, targets] = reflector.getAllAndOverride.mock.calls[0];
      expect(key).toBe(IS_PUBLIC_KEY);
      expect(targets).toHaveLength(2);
    });
  });
});
