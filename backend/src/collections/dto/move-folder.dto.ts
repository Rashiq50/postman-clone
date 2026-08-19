import type { MoveFolderInput } from '@postman-clone/contracts';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Min, ValidateIf } from 'class-validator';

export class MoveFolderDto implements MoveFolderInput {
  /** `null` moves the folder to the collection root. */
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  parentFolderId: string | null;

  /** 0-based slot among the destination's children; omitted means append. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  index?: number;
}
