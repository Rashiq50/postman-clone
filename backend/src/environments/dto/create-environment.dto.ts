import {
  ENVIRONMENT_NAME_MAX_LENGTH,
  type CreateEnvironmentInput,
  type EnvironmentVariable,
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
import { EnvironmentVariablesConstraint } from '../../requests/dto/json-constraints';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateEnvironmentDto implements CreateEnvironmentInput {
  @IsUUID()
  workspaceId: string;

  @IsString()
  @Transform(trimmed)
  @IsNotEmpty()
  @MaxLength(ENVIRONMENT_NAME_MAX_LENGTH)
  name: string;

  /** One constraint, not `@ValidateNested` — see `json-constraints.ts`. */
  @IsOptional()
  @Validate(EnvironmentVariablesConstraint)
  variables?: EnvironmentVariable[];
}
