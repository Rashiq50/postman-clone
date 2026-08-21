import {
  COLLECTION_NAME_MAX_LENGTH,
  type CreateFolderInput,
} from '@raven/contracts';
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

export class CreateFolderDto implements CreateFolderInput {
  @IsUUID()
  collectionId: string;

  /** Omitted or null puts the folder at the collection root. */
  @IsOptional()
  @IsUUID()
  parentFolderId?: string | null;

  @IsString()
  @Transform(trimmed)
  @IsNotEmpty()
  @MaxLength(COLLECTION_NAME_MAX_LENGTH)
  name: string;
}
