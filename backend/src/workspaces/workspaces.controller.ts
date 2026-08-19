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
import { API_VERSION, type Paginated } from '@postman-clone/contracts';
import type { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { WorkspacesService } from './workspaces.service';

/**
 * No `@UseGuards` and no `@Public()` anywhere in this feature: `JwtAuthGuard`
 * is a global `APP_GUARD`, so every route here is authenticated by default, and
 * authorization lives inside the SQL rather than in a guard — see
 * `workspace-scope.ts` for why.
 */
@Controller({ path: 'workspaces', version: API_VERSION })
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<WorkspaceResponseDto>> {
    const page = await this.workspacesService.findAll(user.userId, query);
    return { ...page, data: WorkspaceResponseDto.fromMany(page.data) };
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    return WorkspaceResponseDto.from(
      await this.workspacesService.create(user.userId, dto.name),
    );
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkspaceResponseDto> {
    return WorkspaceResponseDto.from(
      await this.workspacesService.findOne(user.userId, id),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    return WorkspaceResponseDto.from(
      await this.workspacesService.update(user.userId, id, dto),
    );
  }

  /** 409 when it is the caller's personal workspace — see the service. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.workspacesService.remove(user.userId, id);
  }
}
