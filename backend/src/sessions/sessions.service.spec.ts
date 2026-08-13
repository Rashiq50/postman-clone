import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sha256 } from '../common/crypto/sha256';
import { SessionEntity } from './entities/session.entity';
import { SessionsService } from './sessions.service';

describe('SessionsService', () => {
  let service: SessionsService;
  let sessionsRepository: { create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    sessionsRepository = {
      create: jest.fn((entity: Partial<SessionEntity>) => entity),
      save: jest.fn((entity: Partial<SessionEntity>) =>
        Promise.resolve({ id: 'session-1', ...entity }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        {
          provide: getRepositoryToken(SessionEntity),
          useValue: sessionsRepository,
        },
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('30d') },
        },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('stores only the hash of the refresh token, never the token itself', async () => {
      const { refreshToken } = await service.create('user-1');

      const stored = sessionsRepository.create.mock
        .calls[0][0] as SessionEntity;
      expect(stored.refreshTokenHash).toBe(sha256(refreshToken));
      expect(stored.refreshTokenHash).not.toBe(refreshToken);
    });

    it('issues a high-entropy token and a fresh one each time', async () => {
      const first = await service.create('user-1');
      const second = await service.create('user-1');

      // 32 random bytes, base64url-encoded.
      expect(first.refreshToken).toHaveLength(43);
      expect(first.refreshToken).not.toBe(second.refreshToken);
    });

    it('expires the session per REFRESH_TOKEN_EXPIRES_IN', async () => {
      const before = Date.now();

      await service.create('user-1');

      const stored = sessionsRepository.create.mock
        .calls[0][0] as SessionEntity;
      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + thirtyDays,
      );
      expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + thirtyDays,
      );
    });
  });
});
