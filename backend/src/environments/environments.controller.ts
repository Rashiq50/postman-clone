import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { API_VERSION, type Paginated } from '@raven/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateEnvironmentDto } from './dto/create-environment.dto';
import { EnvironmentResponseDto } from './dto/environment-response.dto';
import { UpdateEnvironmentDto } from './dto/update-environment.dto';
import { EnvironmentsService } from './environments.service';

/**
 * The list is nested under its workspace because a workspace id is not
 * derivable from anything else; create stays flat with `workspaceId` in the
 * body, the same rule as every other resource here. Two controllers rather than
 * one only because the two paths differ.
 *
 * Nothing in the frontend calls these yet — see `EnvironmentsService` for why.
 */
@Controller({ path: 'workspaces', version: API_VERSION })
export class WorkspaceEnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Get(':workspaceId/environments')
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<EnvironmentResponseDto>> {
    const page = await this.environmentsService.findAllInWorkspace(
      user.userId,
      workspaceId,
      query,
    );
    return { ...page, data: EnvironmentResponseDto.fromMany(page.data) };
  }
}

@Controller({ path: 'environments', version: API_VERSION })
export class EnvironmentsController {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateEnvironmentDto,
  ): Promise<EnvironmentResponseDto> {
    return EnvironmentResponseDto.from(
      await this.environmentsService.create(user.userId, dto),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnvironmentDto,
  ): Promise<EnvironmentResponseDto> {
    return EnvironmentResponseDto.from(
      await this.environmentsService.update(user.userId, id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.environmentsService.remove(user.userId, id);
  }
}
