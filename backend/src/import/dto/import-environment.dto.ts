import type { ImportEnvironmentInput } from '@raven/contracts';
import { IsUUID, Validate } from 'class-validator';
import { PostmanEnvironmentConstraint } from './postman-constraints';

export class ImportEnvironmentDto implements ImportEnvironmentInput {
  @IsUUID()
  workspaceId: string;

  /** See the note on `ImportCollectionDto.data`. */
  @Validate(PostmanEnvironmentConstraint)
  data: unknown;
}
