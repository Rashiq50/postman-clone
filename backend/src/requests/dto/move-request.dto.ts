import type { MoveApiRequestInput } from '@raven/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';

export class MoveRequestDto implements MoveApiRequestInput {
  /** `null` moves the request to the collection root. */
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  folderId: string | null;

  /**
   * The 0-based slot among the destination's children **after** the move —
   * never a raw `position`. A client must not be guessing integers out of a
   * sequence it does not control. Omitted means append.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  index?: number;
}
