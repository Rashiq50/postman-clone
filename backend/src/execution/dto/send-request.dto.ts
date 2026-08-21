import type {
  HttpMethod,
  KeyValueEntry,
  RequestAuth,
  RequestBody,
  SendDraft,
  SendRequestInput,
} from '@postman-clone/contracts';
import { HTTP_METHODS } from '@postman-clone/contracts';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  KeyValueEntriesConstraint,
  RequestAuthConstraint,
  RequestBodyConstraint,
} from '../../requests/dto/json-constraints';

/**
 * The editable subset a send may carry instead of the saved row.
 *
 * ⚠️ Deliberately carries **no `collectionId` or `folderId`**: a draft cannot
 * reparent anything, and the stored row remains the authorization anchor.
 */
export class SendDraftDto implements SendDraft {
  @IsOptional()
  @IsIn(HTTP_METHODS)
  method?: HttpMethod;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @Validate(KeyValueEntriesConstraint)
  headers?: KeyValueEntry[];

  @IsOptional()
  @Validate(KeyValueEntriesConstraint)
  queryParams?: KeyValueEntry[];

  @IsOptional()
  @Validate(RequestBodyConstraint)
  body?: RequestBody;

  @IsOptional()
  @Validate(RequestAuthConstraint)
  auth?: RequestAuth;
}

export class SendRequestDto implements SendRequestInput {
  /**
   * Omitted → the caller's active environment. `null` → no environment at all.
   * `@ValidateIf` is what keeps those two genuinely distinct: `@IsOptional()`
   * alone would treat `null` as an omission and silently apply the active
   * environment to a send that asked for none.
   */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  environmentId?: string | null;

  /**
   * ⚠️ `@ValidateNested` is safe **here** and forbidden in the request DTOs,
   * and the difference is worth restating rather than looking like an
   * inconsistency: `whitelist` strips keys a decorated nested class does not
   * declare, so a nested class over a *union* (a `RequestBody`) mangles a saved
   * body. `SendDraftDto` declares flat top-level fields whose values are
   * checked by `@Validate(...)` as **plain objects**, and plain objects pass
   * through untouched.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => SendDraftDto)
  draft?: SendDraftDto;
}
