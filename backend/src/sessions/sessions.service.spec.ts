import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sha256 } from '../common/crypto/sha256';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { SessionEntity } from './entities/session.entity';
import { SessionsService } from './sessions.service';

const GRACE_MS = 10_000;

/**
 * A fake `EntityManager` covering the handful of methods `rotateWithin` uses.
 * Testing the state machine against this rather than a live database is the
 * entire reason `rotate` is split into a transaction wrapper and an inner
 * function that takes a manager.
 */
function createFakeManager(options: {
  token: Partial<RefreshTokenEntity> | null;
  session?: Partial<SessionEntity> | null;
}) {
  const updates: Array<{
    target: unknown;
    criteria: unknown;
    values: unknown;
  }> = [];
  const saved: Array<Partial<RefreshTokenEntity>> = [];

  const manager = {
    createQueryBuilder: jest.fn(() => ({
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(options.token),
    })),
    findOne: jest.fn().mockResolvedValue(options.session ?? null),
    create: jest.fn(
      (_target: unknown, entity: Partial<RefreshTokenEntity>) => entity,
    ),
    save: jest.fn((entity: Partial<RefreshTokenEntity>) => {
      entity.id = `token-${saved.length + 1}`;
      saved.push(entity);
      return Promise.resolve(entity);
    }),
    update: jest.fn((target: unknown, criteria: unknown, values: unknown) => {
      updates.push({ target, criteria, values });
      return Promise.resolve({ affected: 1 });
    }),
    query: jest.fn().mockResolvedValue([]),
  };

  const sessionRevocations = () =>
    updates.filter(
      (u) =>
        u.target === SessionEntity &&
        Object.prototype.hasOwnProperty.call(u.values, 'revokedAt'),
    );

  return { manager, updates, saved, sessionRevocations };
}

/** Invokes the private state machine directly; that split is what makes it testable. */
function rotateWithin(
  service: SessionsService,
  manager: unknown,
  rawToken: string,
): Promise<{ kind: string; [key: string]: unknown }> {
  return (
    service as unknown as {
      rotateWithin: (
        m: unknown,
        t: string,
      ) => Promise<{ kind: string; [key: string]: unknown }>;
    }
  ).rotateWithin(manager, rawToken);
}

describe('SessionsService', () => {
  let service: SessionsService;
  let sessionsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    findAndCount: jest.Mock;
    createQueryBuilder: jest.Mock;
    manager: { transaction: jest.Mock };
  };
  let refreshTokensRepository: { findOne: jest.Mock };
  let transactionManager: ReturnType<typeof createFakeManager>['manager'];
  let updateBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    delete: jest.Mock;
    from: jest.Mock;
    execute: jest.Mock;
  };

  beforeEach(async () => {
    const fake = createFakeManager({ token: null });
    transactionManager = fake.manager;

    updateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    sessionsRepository = {
      create: jest.fn((_target: unknown, entity: Partial<SessionEntity>) =>
        entity ? entity : _target,
      ),
      save: jest.fn((entity: Partial<SessionEntity>) =>
        Promise.resolve({ id: 'session-1', ...entity }),
      ),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(() => updateBuilder),
      manager: {
        transaction: jest.fn((callback: (m: unknown) => Promise<unknown>) =>
          callback(transactionManager),
        ),
      },
    };

    refreshTokensRepository = { findOne: jest.fn().mockResolvedValue(null) };

    const config: Record<string, string | number> = {
      REFRESH_TOKEN_EXPIRES_IN: '30d',
      REFRESH_ROTATION_GRACE_MS: GRACE_MS,
      MAX_SESSIONS_PER_USER: 10,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        {
          provide: getRepositoryToken(SessionEntity),
          useValue: sessionsRepository,
        },
        {
          provide: getRepositoryToken(RefreshTokenEntity),
          useValue: refreshTokensRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => config[key]),
            get: jest.fn((key: string) => config[key]),
          },
        },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    // The transaction manager's `create` is called with (EntityClass, values).
    const savedRefreshToken = () =>
      transactionManager.save.mock.calls
        .map(([entity]) => entity)
        .find((entity) => typeof entity.tokenHash === 'string');

    it('stores only the hash of the refresh token, never the token itself', async () => {
      const { refreshToken } = await service.create('user-1');

      const stored = savedRefreshToken();
      expect(stored?.tokenHash).toBe(sha256(refreshToken));
      expect(stored?.tokenHash).not.toBe(refreshToken);
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

      const { expiresAt } = await service.create('user-1');

      const thirtyDays = 30 * 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + thirtyDays);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDays);
    });

    it('gives the first refresh token the session’s own expiry', async () => {
      const { expiresAt } = await service.create('user-1');

      expect(savedRefreshToken()?.expiresAt).toEqual(expiresAt);
    });

    it('writes the session and its first token in one transaction', async () => {
      await service.create('user-1');

      // A session that exists without a redeemable token is a session nobody
      // can ever refresh, so the two writes must not be separable.
      expect(sessionsRepository.manager.transaction).toHaveBeenCalledTimes(1);
      expect(transactionManager.save).toHaveBeenCalledTimes(2);
    });

    it('records the device context on the session', async () => {
      await service.create('user-1', {
        userAgent: 'Mozilla/5.0',
        ipAddress: '203.0.113.7',
      });

      const session = transactionManager.save.mock.calls
        .map(([entity]) => entity as Partial<SessionEntity>)
        .find((entity) => entity.userAgent !== undefined);
      expect(session?.userAgent).toBe('Mozilla/5.0');
      expect(session?.ipAddress).toBe('203.0.113.7');
    });

    describe('session cap', () => {
      it('trims past the cap inside the same transaction, after the insert', async () => {
        await service.create('user-1');

        expect(transactionManager.query).toHaveBeenCalledTimes(1);
        const [sql, params] = transactionManager.query.mock.calls[0] as [
          string,
          unknown[],
        ];
        expect(sql).toContain('UPDATE "sessions" SET "revokedAt" = now()');
        expect(params).toEqual(['user-1', 10]);
      });

      // Revoked, not deleted: the row stays queryable for audit and is
      // collected later by deleteExpiredSessions.
      it('revokes rather than deletes', async () => {
        await service.create('user-1');

        const [sql] = transactionManager.query.mock.calls[0] as [string];
        expect(sql).not.toContain('DELETE');
      });

      /**
       * `lastUsedAt` is null until a session's first rotation, and Postgres
       * sorts nulls first under DESC — so a bare `ORDER BY "lastUsedAt" DESC`
       * would rank every never-refreshed session as the *most* recently active
       * and evict exactly the sessions in use. A bare ordering passes every
       * other assertion in this file, which is why this one is explicit.
       */
      it('orders by COALESCE(lastUsedAt, createdAt), not by lastUsedAt alone', async () => {
        await service.create('user-1');

        const [sql] = transactionManager.query.mock.calls[0] as [string];
        expect(sql).toContain('ORDER BY COALESCE("lastUsedAt", "createdAt")');
      });

      it('only considers sessions that are still live', async () => {
        await service.create('user-1');

        const [sql] = transactionManager.query.mock.calls[0] as [string];
        expect(sql).toContain('"revokedAt" IS NULL');
        expect(sql).toContain('"expiresAt" > now()');
      });
    });
  });

  describe('isActive', () => {
    it('requires the session to be unrevoked and unexpired, in SQL', async () => {
      await service.isActive('session-1');

      const { where } = (
        sessionsRepository.count.mock.calls[0] as unknown[]
      )[0] as {
        where: Record<string, unknown>;
      };
      expect(where.id).toBe('session-1');
      // IsNull() / MoreThan(now) operators, not values compared in JS.
      expect(where.revokedAt).toBeDefined();
      expect(where.expiresAt).toBeDefined();
    });

    it('is false when no row matches', async () => {
      sessionsRepository.count.mockResolvedValue(0);

      await expect(service.isActive('session-1')).resolves.toBe(false);
    });

    it('is true when a live session matches', async () => {
      await expect(service.isActive('session-1')).resolves.toBe(true);
    });
  });

  describe('findByRefreshToken', () => {
    it('looks the token up by hash, never by the raw value', async () => {
      await service.findByRefreshToken('raw-token');

      expect(refreshTokensRepository.findOne).toHaveBeenCalledWith({
        where: { tokenHash: sha256('raw-token') },
      });
    });
  });

  describe('rotateWithin', () => {
    const liveSession = (): Partial<SessionEntity> => ({
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    it('spends the old token, mints a replacement and links the two', async () => {
      const fake = createFakeManager({
        token: {
          id: 'token-1',
          sessionId: 'session-1',
          usedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
        session: liveSession(),
      });

      const outcome = await rotateWithin(service, fake.manager, 'raw-token');

      expect(outcome.kind).toBe('rotated');
      expect(outcome.refreshToken).toHaveLength(43);

      const used = fake.updates.find(
        (u) =>
          u.target === RefreshTokenEntity &&
          Object.prototype.hasOwnProperty.call(u.values, 'usedAt'),
      );
      expect(used).toBeDefined();

      const linked = fake.updates.find(
        (u) =>
          u.target === RefreshTokenEntity &&
          Object.prototype.hasOwnProperty.call(u.values, 'replacedByTokenId'),
      );
      expect(linked?.values).toEqual({ replacedByTokenId: 'token-1' });
    });

    it('stamps lastUsedAt on the session, and only here', async () => {
      const fake = createFakeManager({
        token: {
          id: 'token-1',
          sessionId: 'session-1',
          usedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
        session: liveSession(),
      });

      await rotateWithin(service, fake.manager, 'raw-token');

      const touched = fake.updates.find(
        (u) =>
          u.target === SessionEntity &&
          Object.prototype.hasOwnProperty.call(u.values, 'lastUsedAt'),
      );
      expect(touched).toBeDefined();
    });

    it('gives the child the session’s expiry, never a fresh one', async () => {
      const session = liveSession();
      const fake = createFakeManager({
        token: {
          id: 'token-1',
          sessionId: 'session-1',
          usedAt: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        },
        session,
      });

      await rotateWithin(service, fake.manager, 'raw-token');

      // Absolute, never sliding: sliding expiry would let a stolen token grant
      // access indefinitely, which is what reuse detection exists to bound.
      expect(fake.saved[0].expiresAt).toBe(session.expiresAt);
    });

    it('locks the token row alone, with no join', async () => {
      const fake = createFakeManager({ token: null });

      await rotateWithin(service, fake.manager, 'raw-token');

      // Postgres rejects FOR UPDATE against the nullable side of an outer join,
      // and TypeORM's findOne({ lock, relations }) throws outright — so the
      // session must be a separate read.
      const builder = fake.manager.createQueryBuilder.mock.results[0].value as {
        setLock: jest.Mock;
      };
      expect(builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    describe('reuse detection', () => {
      it('revokes the whole family when a spent token is replayed past the grace window', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: new Date(Date.now() - GRACE_MS - 1_000),
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: liveSession(),
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        /**
         * Both halves matter, and this is the highest-severity trap in the
         * feature: the revocation must have been *written*, and the function
         * must have *returned* rather than thrown. Throwing from inside the
         * transaction would roll the revocation back, leaving a detector that
         * still 401s the caller and so still looks correct in casual testing —
         * while never actually revoking anything.
         */
        expect(fake.sessionRevocations()).toHaveLength(1);
        expect(outcome.kind).toBe('reuse');
        expect(outcome.sessionId).toBe('session-1');
        expect(outcome.userId).toBe('user-1');
      });

      it('accepts a fast replay as two tabs racing', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: new Date(Date.now() - 100),
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: liveSession(),
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('rotated');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });

      /**
       * The window stays anchored at the token's *first* use. Re-stamping
       * `usedAt` here would slide it forward on every replay, so an attacker
       * replaying a stolen token every `grace − ε` would read as benign forever
       * and reuse detection would never fire at all.
       */
      it('does not re-stamp usedAt or relink the parent on the grace path', async () => {
        const firstUse = new Date(Date.now() - 100);
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: firstUse,
            revokedAt: null,
            replacedByTokenId: 'token-original-child',
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: liveSession(),
        });

        await rotateWithin(service, fake.manager, 'raw-token');

        expect(
          fake.updates.filter((u) => u.target === RefreshTokenEntity),
        ).toHaveLength(0);
      });
    });

    describe('invalid, revoking nothing', () => {
      // A random guess must not be able to kill somebody's session.
      it('an unknown token', async () => {
        const fake = createFakeManager({ token: null });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('invalid');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });

      it('an already-revoked token', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: null,
            revokedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: liveSession(),
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('invalid');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });

      // Expiry is not theft.
      it('an expired token', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: null,
            revokedAt: null,
            expiresAt: new Date(Date.now() - 1_000),
          },
          session: liveSession(),
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('invalid');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });

      it('a token whose session was revoked elsewhere', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: null,
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: { ...liveSession(), revokedAt: new Date() },
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('invalid');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });

      it('a spent token whose session is already dead', async () => {
        const fake = createFakeManager({
          token: {
            id: 'token-1',
            sessionId: 'session-1',
            usedAt: new Date(Date.now() - GRACE_MS - 1_000),
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          },
          session: { ...liveSession(), revokedAt: new Date() },
        });

        const outcome = await rotateWithin(service, fake.manager, 'raw-token');

        expect(outcome.kind).toBe('invalid');
        expect(fake.sessionRevocations()).toHaveLength(0);
      });
    });
  });

  describe('rotate', () => {
    it('collapses every failure to one message', async () => {
      transactionManager = createFakeManager({ token: null }).manager;

      await expect(service.rotate('raw-token')).rejects.toThrow(
        'Invalid refresh token',
      );
    });
  });

  describe('revokeOwned', () => {
    it('scopes the update to the owner', async () => {
      await service.revokeOwned('user-1', 'session-1');

      expect(updateBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('"userId" = :userId'),
        { sessionId: 'session-1', userId: 'user-1' },
      );
    });

    // 404, not 403: a 403 confirms the id exists and lets anyone enumerate
    // session ids across the system.
    it('is not-found, never forbidden, when nothing matched', async () => {
      updateBuilder.execute.mockResolvedValue({ affected: 0 });

      await expect(service.revokeOwned('user-1', 'session-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('revokeByRefreshToken', () => {
    it('revokes the token’s session, killing every child with it', async () => {
      refreshTokensRepository.findOne.mockResolvedValue({
        id: 'token-1',
        sessionId: 'session-1',
      });

      await service.revokeByRefreshToken('raw-token');

      expect(sessionsRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'session-1' }),
        expect.objectContaining({ revokedAt: expect.any(Date) as Date }),
      );
    });

    // Logout revokes, it does not rotate, so signing out twice is a quiet
    // no-op rather than a security incident. This is also what lets
    // AuthService.login pass whatever cookie the browser presented.
    it('is a silent no-op for an unknown token', async () => {
      refreshTokensRepository.findOne.mockResolvedValue(null);

      await expect(
        service.revokeByRefreshToken('raw-token'),
      ).resolves.toBeUndefined();
      expect(sessionsRepository.update).not.toHaveBeenCalled();
    });

    it('is a silent no-op when no token was presented', async () => {
      await expect(
        service.revokeByRefreshToken(undefined),
      ).resolves.toBeUndefined();
      expect(refreshTokensRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes every live session for the user', async () => {
      await expect(service.revokeAllForUser('user-1')).resolves.toBe(1);

      expect(updateBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('"userId" = :userId'),
        { userId: 'user-1' },
      );
      expect(updateBuilder.andWhere).not.toHaveBeenCalled();
    });

    it('can spare the caller’s own session', async () => {
      await service.revokeAllForUser('user-1', {
        exceptSessionId: 'session-1',
      });

      expect(updateBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('"id" != :exceptSessionId'),
        { exceptSessionId: 'session-1' },
      );
    });
  });

  describe('findActiveForUser', () => {
    it('returns only live sessions, most recent activity first', async () => {
      const page = await service.findActiveForUser('user-1', {
        page: 1,
        limit: 20,
      });

      const args = (
        sessionsRepository.findAndCount.mock.calls[0] as unknown[]
      )[0] as {
        where: Record<string, unknown>;
        order: Record<string, string>;
      };
      expect(args.where.revokedAt).toBeDefined();
      expect(args.where.expiresAt).toBeDefined();
      expect(args.order).toEqual({ lastUsedAt: 'DESC', createdAt: 'DESC' });
      // The { data, meta } envelope is absolute — never a bare array.
      expect(page).toEqual({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    });
  });

  describe('deleteExpiredSessions', () => {
    it('deletes only sessions whose absolute expiry has passed', async () => {
      await expect(service.deleteExpiredSessions()).resolves.toBe(1);

      expect(updateBuilder.where).toHaveBeenCalledWith('"expiresAt" <= now()');
    });
  });
});
