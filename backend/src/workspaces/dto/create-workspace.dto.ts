import {
  WORKSPACE_NAME_MAX_LENGTH,
  type CreateWorkspaceInput,
} from '@postman-clone/contracts';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * No `isPersonal` and no `ownerUserId`. The personal workspace is born exactly
 * once, inside the user-creation transaction, and the owner always comes from
 * the verified token.
 */
export class CreateWorkspaceDto implements CreateWorkspaceInput {
  @IsString()
  @Transform(trimmed)
  @IsNotEmpty()
  @MaxLength(WORKSPACE_NAME_MAX_LENGTH)
  name: string;
}
