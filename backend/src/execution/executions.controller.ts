import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { API_VERSION } from '@raven/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequestExecutionDto } from './dto/execution-response.dto';
import { ExecutionsService } from './executions.service';

/**
 * A second controller because the paths diverge: everything keyed on a request
 * lives under `/requests/:id`, and a stored run is addressable on its own id.
 * The precedent is `WorkspaceEnvironmentsController` beside
 * `EnvironmentsController`.
 */
@Controller({ path: 'executions', version: API_VERSION })
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RequestExecutionDto> {
    return RequestExecutionDto.from(
      await this.executions.findOne(user.userId, id),
    );
  }
}
