import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Paginated } from '@postman-clone/contracts';
import crypto from 'node:crypto';
import { EntityManager, IsNull, MoreThan, Repository } from 'typeorm';
import { sha256 } from '../common/crypto/sha256';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { parseDuration } from '../common/duration';
import { ApiException } from '../common/errors/api.exception';
import { paginated } from '../common/pagination';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { SessionEntity } from './entities/session.entity';

/** Where a login came from, for the user's own "your devices" list. */
export interface SessionContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

/** A session plus the one raw refresh token the caller may hand to a client. */
export interface IssuedRefresh {
  session: SessionEntity;
  refreshToken: string;
  expiresAt: Date;
}

/**
 * What one rotation attempt concluded.
 *
 * A return value rather than a thrown error, for the reason spelled out on
 * `rotate` below: reuse has to revoke the family *and* reject the request, and
 * throwing from inside the transaction would roll the revocation back.
 */
type RotateOutcome =
  | {
      kind: 'rotated';
      session: SessionEntity;
      refreshToken: string;
      expiresAt: Date;
    }
  | { kind: 'reuse'; sessionId: string; userId: string }
  | { kind: 'invalid' };

/** 32 bytes of entropy, base64url-encoded — 43 characters. */
function newRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  /**
   * Resolved once, here, so a malformed REFRESH_TOKEN_EXPIRES_IN stops the
   * process at boot instead of surfacing on somebody's first login.
   */
  private readonly refreshTtlMs: number;
  private readonly rotationGraceMs: number;
  private readonly maxSessionsPerUser: number;

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionsRepository: Repository<SessionEntity>,
    @InjectRepository(RefreshTokenEntity)
    private readonly refreshTokensRepository: Repository<RefreshTokenEntity>,
    private readonly configService: ConfigService,
  ) {
    this.refreshTtlMs = parseDuration(
      this.configService.getOrThrow<string>('REFRESH_TOKEN_EXPIRES_IN'),
    );
    this.rotationGraceMs = Number(
      this.configService.get<number>('REFRESH_ROTATION_GRACE_MS') ?? 10_000,
    );
    this.maxSessionsPerUser = Number(
      this.configService.get<number>('MAX_SESSIONS_PER_USER') ?? 10,
    );
  }

  /**
   * Opens a session and mints its first refresh token in one transaction, so a
   * session can never exist without a token that redeems it.
   */
  async create(
    userId: string,
    context?: SessionContext,
  ): Promise<IssuedRefresh> {
    const refreshToken = newRefreshToken();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    const session = await this.sessionsRepository.manager.transaction(
      async (manager) => {
        const created = manager.create(SessionEntity, {
          user: { id: userId },
          userAgent: context?.userAgent ?? null,
          ipAddress: context?.ipAddress ?? null,
          expiresAt,
          revokedAt: null,
          lastUsedAt: null,
        });
        await manager.save(created);

        await manager.save(
          manager.create(RefreshTokenEntity, {
            session: { id: created.id },
            tokenHash: sha256(refreshToken),
            // Inherits the session's absolute expiry. A rotation never extends
            // it: sliding expiry would let a stolen token grant access
            // indefinitely, which is what reuse detection exists to bound.
            expiresAt,
          }),
        );

        await this.enforceSessionCap(manager, userId);

        return created;
      },
    );

    return { session, refreshToken, expiresAt };
  }

  /**
   * Revokes everything past `MAX_SESSIONS_PER_USER`, least recently active
   * first. Runs inside `create`'s transaction *after* the insert:
   * create-then-trim makes the count exact, and the session just issued is by
   * definition the most recent, so it can never be the one revoked.
   *
   * One set-based statement, and each property below is something a
   * read-then-write loop would get wrong:
   *
   * - **No race.** Two simultaneous logins would each read `count === MAX`,
   *   each revoke one, each insert, and land at `MAX + 1`. A single statement
   *   inside the transaction has no read-then-write window, so concurrent
   *   logins converge.
   * - **Self-healing.** It revokes *everything* past the cap rather than one
   *   row, so lowering the limit in `.env` trims users down on their next
   *   login instead of leaving them permanently over it.
   * - **`COALESCE("lastUsedAt", "createdAt")` is load-bearing.** `lastUsedAt`
   *   is null until a session's first rotation and Postgres sorts nulls first
   *   under `DESC`, so ordering on the bare column would rank every
   *   never-refreshed session as the *most* recently active and preferentially
   *   evict the ones actually in use.
   *
   * "Oldest inactive" is read here as relative, not absolute. An idle-threshold
   * policy is not a cap: a user with `MAX` genuinely active sessions would have
   * nothing to trim, and the login would then have to either exceed the cap or
   * fail. Strictly oldest-by-last-activity always makes room.
   *
   * Revoked, never deleted: the row stays queryable for audit, and physical
   * removal is already `deleteExpiredSessions`'s job once `expiresAt` passes.
   *
   * Revoking the parent alone is enough — both `isActive` and `rotate` gate on
   * the session, so the children need no update.
   */
  private async enforceSessionCap(
    manager: EntityManager,
    userId: string,
  ): Promise<number> {
    const revoked: unknown = await manager.query(
      `UPDATE "sessions" SET "revokedAt" = now()
       WHERE "id" IN (
         SELECT "id" FROM "sessions"
         WHERE "userId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now()
         ORDER BY COALESCE("lastUsedAt", "createdAt") DESC
         OFFSET $2
       )
       RETURNING "id"`,
      [userId, this.maxSessionsPerUser],
    );

    return Array.isArray(revoked) ? revoked.length : 0;
  }

  /**
   * Whether `sessionId` may still authenticate a request: it exists, was not
   * revoked, and has not expired.
   *
   * Both conditions are evaluated in SQL against the current time rather than
   * read into memory and compared, so a session cannot be considered live on
   * the strength of a stale row this process loaded earlier.
   */
  async isActive(sessionId: string): Promise<boolean> {
    const count = await this.sessionsRepository.count({
      where: {
        id: sessionId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });

    return count > 0;
  }

  /** Looks a raw token up by its hash. Null for anything unknown. */
  findByRefreshToken(rawToken: string): Promise<RefreshTokenEntity | null> {
    return this.refreshTokensRepository.findOne({
      where: { tokenHash: sha256(rawToken) },
    });
  }

  /**
   * Spends a refresh token and issues its replacement.
   *
   * ⚠️ **The rollback trap.** Reuse has to do two things: revoke the whole
   * family, and reject the request. Doing the second with a `throw` from inside
   * `manager.transaction` rolls back the first — the revocation is undone and
   * the reuse detector becomes a no-op that still *looks* correct in casual
   * testing, because the caller does get their 401. So `rotateWithin` returns a
   * discriminated outcome, the transaction commits, and only then does this
   * method throw.
   *
   * The session is derived from the token rather than passed in. A
   * caller-supplied session id would be a mismatch bug waiting to happen.
   */
  async rotate(rawToken: string): Promise<IssuedRefresh> {
    const outcome = await this.sessionsRepository.manager.transaction(
      (manager) => this.rotateWithin(manager, rawToken),
    );

    if (outcome.kind === 'rotated') {
      return {
        session: outcome.session,
        refreshToken: outcome.refreshToken,
        expiresAt: outcome.expiresAt,
      };
    }

    if (outcome.kind === 'reuse') {
      this.logger.warn(
        `Refresh token reuse detected for session ${outcome.sessionId} (user ${outcome.userId}); the session family has been revoked.`,
      );
    }

    // Unknown, revoked, expired and replayed all collapse to one message. The
    // client's remedy is identical — log in again — and confirming to an
    // attacker that their replay was specifically *detected* is free
    // intelligence. Same reasoning as the collapsed messages in
    // `jwt-auth.guard.ts`; the detail goes to the log above instead.
    throw ApiException.unauthenticated('Invalid refresh token');
  }

  /**
   * The rotation state machine, separated from the transaction that wraps it so
   * it can be unit-tested against a fake `EntityManager` rather than a live
   * database.
   *
   * **Concurrency: the lock and the grace window are a pair.** The lock alone
   * turns a benign double-tab race into a forced logout — the loser wakes,
   * sees `usedAt` set, and nukes the family. The grace window alone leaves the
   * state machine non-deterministic. Together, the lock serialises the two
   * requests and the grace window tells the loser it is a tab, not a thief.
   */
  private async rotateWithin(
    manager: EntityManager,
    rawToken: string,
  ): Promise<RotateOutcome> {
    const tokenHash = sha256(rawToken);

    // Lock the token row **alone**, with no join: Postgres rejects `FOR UPDATE`
    // against the nullable side of an outer join, and TypeORM's
    // `findOne({ lock, relations })` throws outright. The session is loaded
    // separately below.
    const token = await manager
      .createQueryBuilder(RefreshTokenEntity, 't')
      .setLock('pessimistic_write')
      .where('t."tokenHash" = :tokenHash', { tokenHash })
      .getOne();

    // Revoke nothing on a miss. A random guess must not be able to kill a
    // session, or anyone who can reach this endpoint can log anyone out.
    if (!token) {
      return { kind: 'invalid' };
    }

    // Already dead: whatever killed it dealt with the family too.
    if (token.revokedAt) {
      return { kind: 'invalid' };
    }

    const session = await manager.findOne(SessionEntity, {
      where: { id: token.sessionId },
    });

    const now = new Date();
    const sessionUsable =
      session !== null &&
      session.revokedAt === null &&
      session.expiresAt.getTime() > now.getTime();

    if (token.usedAt) {
      const withinGrace =
        now.getTime() - token.usedAt.getTime() <= this.rotationGraceMs;

      if (withinGrace && session && sessionUsable) {
        // Two tabs racing: both held the same token and the loser arrived
        // moments after the winner spent it. Mint another child off the same
        // parent.
        //
        // ⚠️ Leave the old row completely untouched — do not re-stamp `usedAt`
        // and do not overwrite `replacedByTokenId`. The grace window must stay
        // anchored at the token's *first* use: re-stamping would slide it
        // forward on every replay, so an attacker replaying a stolen token
        // every `grace − ε` would read as benign forever and reuse detection
        // would never fire. Keeping `replacedByTokenId` pointed at the first
        // child also leaves the forensic chain intact.
        //
        // Two live siblings exist briefly. Both belong to the same revocable
        // session, so it costs nothing.
        const issued = await this.issueChild(manager, session);
        return {
          kind: 'rotated',
          session,
          refreshToken: issued.refreshToken,
          expiresAt: session.expiresAt,
        };
      }

      if (!session || !sessionUsable) {
        // The family is already gone; there is nothing left to revoke.
        return { kind: 'invalid' };
      }

      // A spent token presented past the grace window. Either it leaked or the
      // client is badly broken, and both mean this session can no longer be
      // trusted — so the whole family goes.
      await manager.update(
        SessionEntity,
        { id: session.id },
        { revokedAt: now },
      );

      return { kind: 'reuse', sessionId: session.id, userId: session.userId };
    }

    // Expiry is not theft. A token that simply ran out, or whose session a
    // logout elsewhere already revoked, revokes nothing further.
    if (
      !session ||
      !sessionUsable ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return { kind: 'invalid' };
    }

    // Happy path: spend the old token, mint its replacement, link the two.
    await manager.update(RefreshTokenEntity, { id: token.id }, { usedAt: now });

    const issued = await this.issueChild(manager, session);

    await manager.update(
      RefreshTokenEntity,
      { id: token.id },
      { replacedByTokenId: issued.tokenId },
    );

    // The one place `lastUsedAt` is written. Not per request — that would turn
    // the guard's single indexed primary-key read into a read plus a write on
    // every call the API serves.
    await manager.update(
      SessionEntity,
      { id: session.id },
      { lastUsedAt: now },
    );

    return {
      kind: 'rotated',
      session,
      refreshToken: issued.refreshToken,
      expiresAt: session.expiresAt,
    };
  }

  /** Inserts one fresh child token for `session`. */
  private async issueChild(
    manager: EntityManager,
    session: SessionEntity,
  ): Promise<{ refreshToken: string; tokenId: string }> {
    const refreshToken = newRefreshToken();

    const child = manager.create(RefreshTokenEntity, {
      session: { id: session.id },
      tokenHash: sha256(refreshToken),
      expiresAt: session.expiresAt,
    });
    await manager.save(child);

    return { refreshToken, tokenId: child.id };
  }

  /** Ends a session and, with it, every refresh token in its family. */
  async revoke(sessionId: string): Promise<void> {
    await this.sessionsRepository.update(
      { id: sessionId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Ownership test and write in one guarded statement, so there is no window
   * between checking and acting.
   *
   * `affected === 0` is a `NotFoundException`, never a 403: a 403 would confirm
   * the id exists and let anyone enumerate session ids across the system.
   */
  async revokeOwned(userId: string, sessionId: string): Promise<void> {
    const result = await this.sessionsRepository
      .createQueryBuilder()
      .update(SessionEntity)
      .set({ revokedAt: new Date() })
      .where(
        '"id" = :sessionId AND "userId" = :userId AND "revokedAt" IS NULL',
        { sessionId, userId },
      )
      .execute();

    if (!result.affected) {
      throw new NotFoundException(`Session with id "${sessionId}" not found`);
    }
  }

  /**
   * Logout. Revokes the session behind a raw token, which kills every child in
   * the family.
   *
   * Never trips reuse detection: logout revokes, it does not rotate. Signing
   * out twice, or with an already-spent cookie, is a quiet no-op rather than a
   * security incident. An unknown token does nothing and throws nothing, which
   * is what lets `AuthService.login` call this with whatever cookie the browser
   * happened to present.
   */
  async revokeByRefreshToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    const token = await this.findByRefreshToken(rawToken);
    if (!token) {
      return;
    }

    await this.revoke(token.sessionId);
  }

  /** Returns how many sessions were revoked, for the caller's logging. */
  async revokeAllForUser(
    userId: string,
    options?: { exceptSessionId?: string },
  ): Promise<number> {
    const query = this.sessionsRepository
      .createQueryBuilder()
      .update(SessionEntity)
      .set({ revokedAt: new Date() })
      .where('"userId" = :userId AND "revokedAt" IS NULL', { userId });

    if (options?.exceptSessionId) {
      query.andWhere('"id" != :exceptSessionId', {
        exceptSessionId: options.exceptSessionId,
      });
    }

    const result = await query.execute();
    return result.affected ?? 0;
  }

  /** The user's live devices, most recent activity first. */
  async findActiveForUser(
    userId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<SessionEntity>> {
    const { page, limit } = query;

    const [sessions, total] = await this.sessionsRepository.findAndCount({
      where: {
        user: { id: userId },
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { lastUsedAt: 'DESC', createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return paginated(sessions, total, page, limit);
  }

  /**
   * Physical cleanup, the second stage of the lifecycle: revoked now, collected
   * once `expiresAt` has passed. Children go with the parent through the FK's
   * `ON DELETE CASCADE`.
   *
   * Deliberately **uncalled** — this is the hook point for a cron job.
   * `@nestjs/schedule` is not a dependency and adding one is a separate change.
   */
  async deleteExpiredSessions(): Promise<number> {
    const result = await this.sessionsRepository
      .createQueryBuilder()
      .delete()
      .from(SessionEntity)
      .where('"expiresAt" <= now()')
      .execute();

    return result.affected ?? 0;
  }
}
