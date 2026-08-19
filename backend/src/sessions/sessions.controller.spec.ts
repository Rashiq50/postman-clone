import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { SessionEntity } from './entities/session.entity';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';

const COOKIE_NAME = 'pc_refresh_token';

const CURRENT_USER: AuthenticatedUser = {
  userId: 'user-1',
  sessionId: 'session-1',
  tokenId: 'jti-1',
};

function fakeResponse() {
  const clearCookie = jest.fn();
  return { res: { clearCookie } as unknown as Response, clearCookie };
}

function session(overrides: Partial<SessionEntity>): SessionEntity {
  return {
    id: 'session-1',
    userAgent: 'Mozilla/5.0',
    ipAddress: '203.0.113.7',
    createdAt: new Date('2026-08-19T10:00:00.000Z'),
    lastUsedAt: null,
    expiresAt: new Date('2026-09-18T10:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  } as SessionEntity;
}

describe('SessionsController', () => {
  let controller: SessionsController;
  let sessionsService: {
    findActiveForUser: jest.Mock;
    revokeOwned: jest.Mock;
  };

  beforeEach(async () => {
    sessionsService = {
      findActiveForUser: jest.fn().mockResolvedValue({
        data: [session({ id: 'session-1' }), session({ id: 'session-2' })],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      }),
      revokeOwned: jest.fn().mockResolvedValue(undefined),
    };

    const config: Record<string, unknown> = {
      AUTH_COOKIE_NAME: COOKIE_NAME,
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
      COOKIE_DOMAIN: '',
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: SessionsService, useValue: sessionsService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => config[key],
            getOrThrow: (key: string) => config[key],
          },
        },
      ],
    }).compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('scopes the list to the verified user and keeps the { data, meta } envelope', async () => {
      const result = await controller.findAll(CURRENT_USER, {
        page: 1,
        limit: 20,
      });

      expect(sessionsService.findActiveForUser).toHaveBeenCalledWith('user-1', {
        page: 1,
        limit: 20,
      });
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('marks exactly the requesting session as current', async () => {
      const result = await controller.findAll(CURRENT_USER, {
        page: 1,
        limit: 20,
      });

      expect(result.data.map((s) => s.current)).toEqual([true, false]);
    });

    it('serialises through the DTO, exposing dates as ISO strings', async () => {
      const result = await controller.findAll(CURRENT_USER, {
        page: 1,
        limit: 20,
      });

      expect(result.data[0].createdAt).toBe('2026-08-19T10:00:00.000Z');
      expect(result.data[0].lastUsedAt).toBeNull();
      // revokedAt is not part of the contract and must not leak through.
      expect(result.data[0]).not.toHaveProperty('revokedAt');
    });
  });

  describe('remove', () => {
    it('revokes through the owner-scoped path', async () => {
      const { res } = fakeResponse();

      await controller.remove(CURRENT_USER, 'session-2', res);

      expect(sessionsService.revokeOwned).toHaveBeenCalledWith(
        'user-1',
        'session-2',
      );
    });

    it('leaves the cookie alone when revoking another device', async () => {
      const { res, clearCookie } = fakeResponse();

      await controller.remove(CURRENT_USER, 'session-2', res);

      expect(clearCookie).not.toHaveBeenCalled();
    });

    // Revoking your own session is a logout, so the cookie has to go with it —
    // otherwise the browser keeps presenting a token whose session is dead.
    it('clears the cookie when revoking the caller’s own session', async () => {
      const { res, clearCookie } = fakeResponse();

      await controller.remove(CURRENT_USER, 'session-1', res);

      expect(clearCookie).toHaveBeenCalledWith(COOKIE_NAME, expect.anything());
    });
  });
});
