import type { SetActiveEnvironmentInput } from '@raven/contracts';
import { IsUUID, ValidateIf } from 'class-validator';

/**
 * `PUT`, not `PATCH`, and therefore **required rather than optional**: this is
 * a total assignment of a single-valued preference in which `null` is a
 * meaningful value ("no environment") rather than an omission.
 *
 * `@ValidateIf` is what lets `null` through while still demanding a real uuid
 * from anything else — `@IsOptional()` would additionally accept `undefined`,
 * which is exactly the omission this endpoint refuses to guess at.
 */
export class SetActiveEnvironmentDto implements SetActiveEnvironmentInput {
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  environmentId: string | null;
}
