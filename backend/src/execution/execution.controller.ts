import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  API_VERSION,
  type Paginated,
  type SendResult,
} from '@raven/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { SKIP_DEFAULT_THROTTLERS } from '../common/throttling/throttler.config';
import { RequestExecutionSummaryDto } from './dto/execution-response.dto';
import { SendRequestDto } from './dto/send-request.dto';
import { ExecutionService } from './execution.service';
import { ExecutionsService } from './executions.service';
import { SendThrottlerGuard } from './send-throttler.guard';

/**
 * ⚠️ **A failed upstream request is not an API error of ours.**
 *
 * `POST /requests/:id/send` answers **200** whether the target returned 200,
 * returned 500, refused the connection, or was blocked before a socket was
 * opened. The outcome lives inside the body, in a union discriminated on
 * `outcome`. Our error envelope (`{ error: { code, … } }`) is reserved,
 * strictly, for **our** failures: a malformed DTO (400), a request we will not
 * show you (404) or will not let you act on (403), an environment we will not
 * show you (404), a rate limit (429), an unexpected throw (500). Nothing about
 * the upstream ever produces one.
 *
 * Collapsing upstream failures into `ApiException` would make a 500 from
 * `httpbin.org` indistinguishable from our own backend crashing, would force
 * every client to branch on our HTTP status, and would mean the response pane
 * could never show a 4xx body — which is most of what a person presses Send to
 * look at. It would also make history and the live pane need two renderers for
 * one concept.
 *
 * There is deliberately no `SendResultDto`: `SendResult` is not an entity but a
 * plain object the service assembles field by field against the contract type,
 * so there is no entity leakage for a DTO to prevent and no second shape to
 * keep in step.
 */
@Controller({ path: 'requests', version: API_VERSION })
export class ExecutionController {
  constructor(
    private readonly execution: ExecutionService,
    private readonly executions: ExecutionsService,
  ) {}

  /**
   * **200, not 201.** The addressed thing is the run; the history row is a side
   * effect. Same reasoning that makes login 200 while register is 201 — the
   * resource is what the caller actually asked for.
   */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  // Send has its own budget, keyed on the user rather than the IP. It opts out
  // of register's windows by name; without this it would spend a signup budget
  // sized at five a minute.
  @SkipThrottle(SKIP_DEFAULT_THROTTLERS)
  @UseGuards(SendThrottlerGuard)
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendRequestDto,
  ): Promise<SendResult> {
    return this.execution.send(user.userId, id, dto);
  }

  @Get(':id/executions')
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<RequestExecutionSummaryDto>> {
    const page = await this.executions.findAllForRequest(
      user.userId,
      id,
      query.page,
      query.limit,
    );
    return { ...page, data: RequestExecutionSummaryDto.fromMany(page.data) };
  }

  /** Clearing history destroys shared data, so this one takes `WRITE_ROLES`. */
  @Delete(':id/executions')
  @HttpCode(HttpStatus.NO_CONTENT)
  clear(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.executions.clearForRequest(user.userId, id);
  }
}
