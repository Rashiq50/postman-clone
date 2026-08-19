import { OmitType, PartialType } from '@nestjs/mapped-types';
import type { UpdateEnvironmentInput } from '@postman-clone/contracts';
import { CreateEnvironmentDto } from './create-environment.dto';

export class UpdateEnvironmentDto
  extends PartialType(OmitType(CreateEnvironmentDto, ['workspaceId'] as const))
  implements UpdateEnvironmentInput {}
