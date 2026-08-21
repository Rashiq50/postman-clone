import type {
  HttpMethod,
  RedirectHop,
  RequestExecution,
  RequestExecutionSummary,
  ResponseBodyPayload,
  ResponseHeader,
  SendFailureKind,
  SendTiming,
  SendWarning,
} from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import type { RequestExecutionEntity } from '../entities/request-execution.entity';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

/**
 * A history list row. No body and no headers, so listing 50 runs does not drag
 * 50 response bodies across the wire.
 *
 * The `implements RequestExecutionSummary` clause is load-bearing: if this and
 * `packages/contracts/src/execution.ts` disagree, the backend build fails
 * instead of the browser getting a surprise.
 */
export class RequestExecutionSummaryDto implements RequestExecutionSummary {
  @Expose()
  id: string;

  @Expose()
  requestId: string;

  @Expose()
  method: HttpMethod;

  @Expose()
  url: string;

  @Expose()
  outcome: 'response' | 'failure';

  @Expose()
  status: number | null;

  @Expose()
  statusText: string | null;

  @Expose()
  failureKind: SendFailureKind | null;

  @Expose()
  durationMs: number;

  @Expose()
  bodyBytes: number | null;

  @Expose()
  usedDraft: boolean;

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  static from(row: RequestExecutionEntity): RequestExecutionSummaryDto {
    return plainToInstance(RequestExecutionSummaryDto, row, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(rows: RequestExecutionEntity[]): RequestExecutionSummaryDto[] {
    return rows.map((row) => RequestExecutionSummaryDto.from(row));
  }
}

/**
 * One stored run in full.
 *
 * The body is reassembled into the same `ResponseBodyPayload` union the live
 * result uses, out of the entity's flat `bodyEncoding` + `body` columns — so
 * the client renders a past run and a fresh one with exactly one renderer.
 * ⚠️ That single-renderer property is the same thing the two-outcome contract
 * buys, and it is why the shapes are kept identical rather than merely similar.
 */
export class RequestExecutionDto
  extends RequestExecutionSummaryDto
  implements RequestExecution
{
  @Expose()
  environmentId: string | null;

  @Expose()
  headers: ResponseHeader[];

  @Expose()
  @Transform(({ obj }: { obj: RequestExecutionEntity }): ResponseBodyPayload => {
    if (obj.bodyEncoding === 'text') return { encoding: 'text', text: obj.body ?? '' };
    if (obj.bodyEncoding === 'base64') {
      return { encoding: 'base64', base64: obj.body ?? '' };
    }
    return { encoding: 'empty' };
  })
  body: ResponseBodyPayload;

  @Expose()
  bodyTruncated: boolean;

  @Expose()
  redirects: RedirectHop[];

  @Expose()
  warnings: SendWarning[];

  @Expose()
  timing: SendTiming;

  @Expose()
  failureMessage: string | null;

  static from(row: RequestExecutionEntity): RequestExecutionDto {
    return plainToInstance(RequestExecutionDto, row, {
      excludeExtraneousValues: true,
    });
  }
}
