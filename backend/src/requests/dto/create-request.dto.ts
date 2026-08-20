import {
  HttpMethod,
  REQUEST_NAME_MAX_LENGTH,
  type CreateApiRequestInput,
  type KeyValueEntry,
  type RequestAuth,
  type RequestBody,
  type RequestScripts,
} from '@postman-clone/contracts';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  KeyValueEntriesConstraint,
  RequestAuthConstraint,
  RequestBodyConstraint,
  RequestScriptsConstraint,
} from './json-constraints';

/** Trimmed *before* the emptiness check, matching `RegisterDto.name`. */
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateRequestDto implements CreateApiRequestInput {
  /**
   * The parent, in the **body**. This is the scoping input the service checks
   * against membership — it is never trusted, and never an identity.
   */
  @IsUUID()
  collectionId: string;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @IsString()
  @Transform(trimmed)
  @IsNotEmpty()
  @MaxLength(REQUEST_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsEnum(HttpMethod)
  method?: HttpMethod;

  /** Not trimmed and not URL-validated: a request exists before it has a URL,
   *  and `{{baseUrl}}/users` is a perfectly ordinary value here. */
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

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

  /** Sent whole, both slots at once — there is no partial script patch. */
  @IsOptional()
  @Validate(RequestScriptsConstraint)
  scripts?: RequestScripts;
}
