import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  RelationId,
} from 'typeorm';
import { SessionEntity } from './session.entity';

/**
 * One rotation step of a session's refresh token.
 *
 * The split matters: a **session** is a device/login and keeps a stable `id`,
 * which is what access tokens carry as `sid` and what `JwtAuthGuard` checks on
 * every request. A **refresh token** is one link in that session's chain. If
 * rotation replaced the session row instead, every access token would die the
 * moment its client refreshed, and `GET /sessions` would return a rotation log
 * rather than a list of devices.
 *
 * The family *is* the session, so revoking a whole family — what reuse
 * detection does — is a single `UPDATE sessions SET "revokedAt" = now()`.
 *
 * Unlike `SessionEntity` there is deliberately **no `@UpdateDateColumn`**:
 * these rows are an append-only audit trail. `usedAt`, `revokedAt` and
 * `replacedByTokenId` are each written at most once, and a mutable
 * `updatedAt` would only blur when that happened.
 */
@Entity('refresh_tokens')
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Named explicitly so a future `migration:generate` compares against the
  // hand-written migration instead of churning out a rename.
  @Index('IDX_refresh_tokens_sessionId')
  @ManyToOne(() => SessionEntity, (session) => session.refreshTokens, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'sessionId' })
  session: SessionEntity;

  @RelationId((token: RefreshTokenEntity) => token.session)
  sessionId: string;

  /**
   * SHA-256 hex of the raw token. Unique because it is also the lookup path:
   * redeeming a token is a single indexed read, and the constraint means a
   * collision surfaces as a failed write rather than an ambiguous match.
   */
  @Index('UQ_refresh_tokens_tokenHash', { unique: true })
  @Column({ type: 'varchar', length: 64 })
  tokenHash: string;

  /**
   * Copied from the parent session and never extended. Expiry is absolute, not
   * sliding: a sliding window would let a stolen token grant access
   * indefinitely, which is the thing reuse detection exists to bound.
   */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /**
   * When this token was spent. This one column is the whole reuse detector: a
   * second presentation of a token that already has `usedAt` set is either two
   * tabs racing (inside the grace window) or a replay of a stolen token.
   */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  /** Killed without ever being spent — e.g. its family was revoked. */
  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /**
   * Forensics only: walk forward from a compromised token to see what was
   * minted from it. `SET NULL` so deleting a child never deletes history.
   */
  @Column({ type: 'uuid', nullable: true })
  replacedByTokenId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
