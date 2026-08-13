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
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

/**
 * No `@UseGuards` here: `JwtAuthGuard` is registered globally in auth.module.ts,
 * so every route below is authenticated by default. Handlers take the owner id
 * from `@CurrentUser()` — never from a param or body, which the caller controls.
 */
@Controller({ path: 'tasks', version: API_VERSION })
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() createTaskDto: CreateTaskDto,
  ): Promise<TaskResponseDto> {
    return TaskResponseDto.from(
      await this.tasksService.create(user.userId, createTaskDto),
    );
  }

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<TaskResponseDto>> {
    const page = await this.tasksService.findAll(user.userId, query);
    return { ...page, data: TaskResponseDto.fromMany(page.data) };
  }

  @Get(':id')
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponseDto> {
    return TaskResponseDto.from(
      await this.tasksService.findOne(user.userId, id),
    );
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return TaskResponseDto.from(
      await this.tasksService.update(user.userId, id, updateTaskDto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.tasksService.remove(user.userId, id);
  }
}
