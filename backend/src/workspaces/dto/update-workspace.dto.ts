import { PartialType } from '@nestjs/mapped-types';
import type { UpdateWorkspaceInput } from '@raven/contracts';
import { CreateWorkspaceDto } from './create-workspace.dto';

export class UpdateWorkspaceDto
  extends PartialType(CreateWorkspaceDto)
  implements UpdateWorkspaceInput {}
