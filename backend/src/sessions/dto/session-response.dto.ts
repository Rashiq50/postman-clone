import type { SessionSummary } from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { SessionEntity } from '../entities/session.entity';

/**
 * One live login, as shown in a "your devices" list. `@Expose()`-only, so
 * nothing about the session's token chain can reach the wire.
 */
export class SessionResponseDto implements SessionSummary {
  @Expose()
  id: string;

  /**
   * Set from the requesting token's `sid` rather than exposed off the entity —
   * "current" is a property of who is asking, not of the row.
   */
  @Expose()
  current: boolean;

  @Expose()
  userAgent: string | null;

  @Expose()
  ipAddress: string | null;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  createdAt: string;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  lastUsedAt: string | null;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  expiresAt: string;

  static from(
    session: SessionEntity,
    currentSessionId: string,
  ): SessionResponseDto {
    return plainToInstance(
      SessionResponseDto,
      { ...session, current: session.id === currentSessionId },
      { excludeExtraneousValues: true },
    );
  }

  static fromMany(
    sessions: SessionEntity[],
    currentSessionId: string,
  ): SessionResponseDto[] {
    return sessions.map((session) =>
      SessionResponseDto.from(session, currentSessionId),
    );
  }
}
