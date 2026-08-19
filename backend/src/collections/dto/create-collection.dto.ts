import {
  COLLECTION_NAME_MAX_LENGTH,
  type CreateCollectionInput,
} from '@postman-clone/contracts';
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

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
}
