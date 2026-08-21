import { OmitType, PartialType } from '@nestjs/mapped-types';
import type { UpdateCollectionInput } from '@raven/contracts';
import { CreateCollectionDto } from './create-collection.dto';

/** A collection never changes workspace, so `workspaceId` is not patchable. */
export class UpdateCollectionDto
  extends PartialType(OmitType(CreateCollectionDto, ['workspaceId'] as const))
  implements UpdateCollectionInput {}
