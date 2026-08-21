import { PickType, PartialType } from '@nestjs/mapped-types';
import type { UpdateFolderInput } from '@raven/contracts';
import { CreateFolderDto } from './create-folder.dto';

/**
 * Only the name. Reparenting goes through `PATCH /folders/:id/move`, which is
 * the only path that runs the cycle check and recomputes `position`; allowing
 * `parentFolderId` here would be a second, unguarded way to build a loop.
 */
export class UpdateFolderDto
  extends PartialType(PickType(CreateFolderDto, ['name'] as const))
  implements UpdateFolderInput {}
