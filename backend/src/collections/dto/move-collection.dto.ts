import type { MoveCollectionInput } from '@raven/contracts';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/**
 * A collection has no parent to change, so a move is purely a reorder and
 * `index` is required — there is no "append" that differs from a plain no-op.
 */
export class MoveCollectionDto implements MoveCollectionInput {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  index: number;
}
