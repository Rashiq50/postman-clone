import {
  COLLECTION_NAME_MAX_LENGTH,
  type CollectionAuth,
  type CreateCollectionInput,
  type KeyValueEntry,
} from '@raven/contracts';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Validate,
} from 'class-validator';
import {
  CollectionAuthConstraint,
  KeyValueEntriesConstraint,
} from '../../requests/dto/json-constraints';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCollectionDto implements CreateCollectionInput {
  /** Scoping input, checked against membership — never an identity. */
  @IsUUID()
  workspaceId: string;

  @IsString()
  @Transform(trimmed)
  @IsNotEmpty()
  @MaxLength(COLLECTION_NAME_MAX_LENGTH)
  name: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  /** One constraint, one message — see the note in `json-constraints.ts`. */
  @IsOptional()
  @Validate(CollectionAuthConstraint)
  auth?: CollectionAuth;

  @IsOptional()
  @Validate(KeyValueEntriesConstraint)
  variables?: KeyValueEntry[];
}
