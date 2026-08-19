import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  RelationId,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { RefreshTokenEntity } from './refresh-token.entity';

/**
 * One login on one device. The id is stable for the life of the session and is
 * what an access token carries as `sid`, so revoking here — setting
 * `revokedAt` — kills the access token on its next request and every refresh
 * token in the family at once.
 *
 * The refresh token itself lives in `refresh_tokens`, one row per rotation.
 * This row holds no token material.
 */
@Entity('sessions')
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The index exists in the database (created by AddUsersAndSessions) but was
  // missing from the entity metadata, so `migration:generate` would have
  // emitted a spurious DROP INDEX for it.
  @Index('IDX_sessions_userId')
  @ManyToOne(() => UserEntity, (user) => user.sessions, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @RelationId((session: SessionEntity) => session.user)
  userId: string;

  @OneToMany(() => RefreshTokenEntity, (token) => token.session)
  refreshTokens: RefreshTokenEntity[];

  /** Captured at login for the "your devices" list. Truncated, never parsed. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  /** 45 characters fits a full IPv6 address, including a v4-mapped one. */
  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string | null;

  /** Set once at login and never extended. See `RefreshTokenEntity.expiresAt`. */
  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  /**
   * Written in exactly one place — the happy path of `SessionsService.rotate`.
   * Not per request: that would turn the guard's single indexed primary-key
   * read into a read plus a write on every call the API serves.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
