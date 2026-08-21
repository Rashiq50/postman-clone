import { OmitType, PartialType } from '@nestjs/mapped-types';
import type { UpdateApiRequestInput } from '@raven/contracts';
import { CreateRequestDto } from './create-request.dto';

/**
 * Everything from create except the parent ids: a request changes folder
 * through `PATCH /requests/:id/move`, which is the only path that also
 * recomputes `position`, and it never changes collection at all.
 */
export class UpdateRequestDto
  extends PartialType(
    OmitType(CreateRequestDto, ['collectionId', 'folderId'] as const),
  )
  implements UpdateApiRequestInput {}
