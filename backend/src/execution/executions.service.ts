import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type {
  PageMeta,
  RedirectHop,
  ResponseHeader,
  SendResult,
  SendWarning,
} from '@raven/contracts';
import { Repository } from 'typeorm';
import { explainDenial } from '../workspaces/scope-denial';
import {
  READ_ROLES,
  REQUEST_EXECUTION_SCOPE,
  REQUEST_SCOPE,
  WRITE_ROLES,
  scopeParams,
  scopedWhere,
} from '../workspaces/workspace-scope';
import { RequestEntity } from '../requests/entities/request.entity';
import { RequestExecutionEntity } from './entities/request-execution.entity';
import { redactSecrets } from './redact';
import { SEND_OPTIONS, type SendOptions } from './send-options';

export interface RecordExecutionInput {
  requestId: string;
  userId: string;
  result: SendResult;
  /** Values to mask in everything stored. See `redact.ts`. */
  secretValues: Set<string>;
}

@Injectable()
export class ExecutionsService {
  private readonly logger = new Logger(ExecutionsService.name);

  constructor(
    @InjectRepository(RequestExecutionEntity)
    private readonly executions: Repository<RequestExecutionEntity>,
    @Inject(SEND_OPTIONS) private readonly options: SendOptions,
  ) {}

  /**
   * Writes one history row and enforces the per-request cap.
   *
   * The cap is applied **inside the insert's transaction, after the insert, as
   * one set-based statement** — precisely the shape `SessionsService.create`
   * uses for `MAX_SESSIONS_PER_USER`.
   */
  async record(input: RecordExecutionInput): Promise<string> {
    const { result, secretValues } = input;
    const mask = (text: string) => redactSecrets(text, secretValues);

    const stored = this.storedBody(result);

    return this.executions.manager.transaction(async (manager) => {
      const row = await manager.save(
        manager.create(RequestExecutionEntity, {
          request: { id: input.requestId },
          user: { id: input.userId },
          environmentId: result.environmentId,
          method: result.method,
          url: mask(result.url),
          outcome: result.result.outcome,
          status:
            result.result.outcome === 'response' ? result.result.status : null,
          statusText:
            result.result.outcome === 'response'
              ? result.result.statusText
              : null,
          failureKind:
            result.result.outcome === 'failure' ? result.result.kind : null,
          failureMessage:
            result.result.outcome === 'failure' ? result.result.message : null,
          usedDraft: result.usedDraft,
          bodyEncoding: stored.encoding,
          body: stored.body,
          bodyBytes:
            result.result.outcome === 'response'
              ? result.result.bodyBytes
              : null,
          bodyTruncated: stored.truncated,
          durationMs: Math.round(result.timing.totalMs),
          headers:
            result.result.outcome === 'response' ? result.result.headers : [],
          warnings: stored.warnings,
          // ⚠️ Redacted too: the hops land in jsonb, so an unredacted
          // `?token=<secret>` would survive here even with `url` masked.
          redirects: result.redirects.map((hop) => ({
            status: hop.status,
            from: mask(hop.from),
            to: mask(hop.to),
          })),
          timing: result.timing,
        }),
      );

      // ⚠️ `id` is the tiebreaker: two sends inside one millisecond otherwise
      // make the ordering non-deterministic and this delete non-idempotent.
      await manager.query(
        `DELETE FROM "request_executions"
         WHERE "requestId" = $1 AND "id" NOT IN (
           SELECT "id" FROM "request_executions" WHERE "requestId" = $1
           ORDER BY "createdAt" DESC, "id" DESC LIMIT $2
         )`,
        [input.requestId, this.options.historyPerRequest],
      );

      return row.id;
    });
  }

  /**
   * The stored body, capped far lower than the live one.
   *
   * ⚠️ Bodies are the growth driver for this table:
   * `SEND_MAX_STORED_BODY_BYTES` x `SEND_HISTORY_PER_REQUEST` x every request
   * in the install. `stored-body-truncated` is a warning **on the record**, not
   * on the live result the caller just received — what they saw was complete.
   */
  private storedBody(result: SendResult): {
    encoding: 'text' | 'base64' | 'empty' | null;
    body: string | null;
    truncated: boolean;
    warnings: SendWarning[];
  } {
    if (result.result.outcome !== 'response') {
      return {
        encoding: null,
        body: null,
        truncated: false,
        warnings: result.warnings,
      };
    }

    const payload = result.result.body;
    if (payload.encoding === 'empty') {
      return {
        encoding: 'empty',
        body: null,
        truncated: result.result.bodyTruncated,
        warnings: result.warnings,
      };
    }

    const text = payload.encoding === 'text' ? payload.text : payload.base64;
    const cap = this.options.maxStoredBodyBytes;
    if (Buffer.byteLength(text, 'utf8') <= cap) {
      return {
        encoding: payload.encoding,
        body: text,
        truncated: result.result.bodyTruncated,
        warnings: result.warnings,
      };
    }

    // Slice on a character boundary, not a byte one: a half-written multi-byte
    // sequence would come back out of the column as mojibake.
    const clipped = Buffer.from(text, 'utf8')
      .subarray(0, cap)
      .toString('utf8')
      .replace(/�$/, '');

    return {
      encoding: payload.encoding,
      body: clipped,
      truncated: true,
      warnings: [
        ...result.warnings,
        {
          kind: 'stored-body-truncated',
          message: `Only the first ${cap} bytes of the response body were kept in history.`,
        },
      ],
    };
  }

  /** The history list for one request. No body, so the list stays cheap. */
  async findAllForRequest(
    userId: string,
    requestId: string,
    page: number,
    limit: number,
  ): Promise<{ data: RequestExecutionEntity[]; meta: PageMeta }> {
    await this.assertRequestVisible(userId, requestId);

    const [data, total] = await this.executions
      .createQueryBuilder('e')
      .select([
        'e.id',
        'e.requestId',
        'e.method',
        'e.url',
        'e.outcome',
        'e.status',
        'e.statusText',
        'e.failureKind',
        'e.durationMs',
        'e.bodyBytes',
        'e.usedDraft',
        'e.createdAt',
      ])
      .where(`e."requestId" = :requestId AND ${scopedWhere(REQUEST_EXECUTION_SCOPE, 'e')}`, {
        requestId,
        ...scopeParams(userId, READ_ROLES),
      })
      .orderBy('e."createdAt"', 'DESC')
      .addOrderBy('e."id"', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** One stored run, in full. */
  async findOne(userId: string, id: string): Promise<RequestExecutionEntity> {
    const row = await this.executions
      .createQueryBuilder('e')
      .where(`e."id" = :id AND ${scopedWhere(REQUEST_EXECUTION_SCOPE, 'e')}`, {
        id,
        ...scopeParams(userId, READ_ROLES),
      })
      .getOne();

    if (!row) {
      await explainDenial(
        this.executions.manager,
        RequestExecutionEntity,
        REQUEST_EXECUTION_SCOPE,
        userId,
        id,
      );
    }
    return row!;
  }

  /** Clearing history destroys shared data, so it takes `WRITE_ROLES`. */
  async clearForRequest(userId: string, requestId: string): Promise<void> {
    const result = await this.executions
      .createQueryBuilder()
      .delete()
      .from(RequestExecutionEntity)
      .where(`"requestId" = :requestId AND ${scopedWhere(REQUEST_EXECUTION_SCOPE)}`, {
        requestId,
        ...scopeParams(userId, WRITE_ROLES),
      })
      .execute();

    // A request with no history at all deletes zero rows, which is not a
    // denial — so the visibility check is what distinguishes the two.
    if (!result.affected) {
      await this.assertRequestVisible(userId, requestId, WRITE_ROLES);
    }
  }

  /**
   * Age-based retention.
   *
   * ⚠️ **Implemented, unit-tested and deliberately uncalled** — a hook point
   * for a cron job, exactly like `SessionsService.deleteExpiredSessions()`.
   * `@nestjs/schedule` is not a dependency and this slice does not make it one.
   * Do not "fix" this by deleting it as dead code, and do not wire a scheduler
   * to it without making that its own decision.
   */
  async deleteExpiredExecutions(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(
      now.getTime() - this.options.historyRetentionDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.executions
      .createQueryBuilder()
      .delete()
      .from(RequestExecutionEntity)
      .where('"createdAt" < :cutoff', { cutoff })
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Confirms the caller may see the request at all.
   *
   * Needed because an empty history and a request belonging to somebody else
   * are indistinguishable from the execution rows alone — and answering "no
   * history" for a stranger's request id would be an existence oracle by
   * omission.
   */
  private async assertRequestVisible(
    userId: string,
    requestId: string,
    roles: readonly (typeof READ_ROLES)[number][] = READ_ROLES,
  ): Promise<void> {
    const visible = await this.executions.manager
      .createQueryBuilder()
      .from(RequestEntity, 'r')
      .where(`r."id" = :requestId AND ${scopedWhere(REQUEST_SCOPE, 'r')}`, {
        requestId,
        ...scopeParams(userId, roles),
      })
      .getExists();

    if (!visible) {
      await explainDenial(
        this.executions.manager,
        RequestEntity,
        REQUEST_SCOPE,
        userId,
        requestId,
      );
    }
  }
}
