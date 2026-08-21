import type {
  ApiRequest,
  HttpMethod,
  KeyValueEntry,
  RequestAuth,
  RequestBody,
  RequestScripts,
} from '@raven/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { RequestEntity } from '../entities/request.entity';

const isoDate = ({ value }: { value: unknown }) =>
  value instanceof Date ? value.toISOString() : value;

/**
 * `implements ApiRequest` is the compile-time contract check: if this and
 * `packages/contracts/src/request.ts` disagree, the backend build fails rather
 * than the browser getting a surprise.
 *
 * ⚠️ `auth` is exposed as stored, which means bearer tokens and passwords go
 * out in **plaintext**. That is what Postman does and an accepted trade-off for
 * this slice; the fix is a write-only secrets table with envelope encryption.
 * It is recorded in the README so it stays a decision rather than an oversight.
 */
export class RequestResponseDto implements ApiRequest {
  @Expose()
  id: string;

  @Expose()
  collectionId: string;

  @Expose()
  folderId: string | null;

  @Expose()
  name: string;

  @Expose()
  method: HttpMethod;

  @Expose()
  url: string;

  @Expose()
  description: string | null;

  // jsonb columns arrive already parsed by the pg driver and are exposed whole.
  // `excludeExtraneousValues` only drops top-level keys, so nested shapes
  // survive intact — pinned by request-response.dto.spec.ts.
  @Expose()
  headers: KeyValueEntry[];

  @Expose()
  queryParams: KeyValueEntry[];

  @Expose()
  body: RequestBody;

  @Expose()
  auth: RequestAuth;

  @Expose()
  scripts: RequestScripts;

  @Expose()
  position: number;

  @Expose()
  @Transform(isoDate)
  createdAt: string;

  @Expose()
  @Transform(isoDate)
  updatedAt: string;

  static from(request: RequestEntity): RequestResponseDto {
    return plainToInstance(RequestResponseDto, request, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(requests: RequestEntity[]): RequestResponseDto[] {
    return requests.map((request) => RequestResponseDto.from(request));
  }
}
