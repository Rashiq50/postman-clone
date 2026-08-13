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
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskResponseDto } from './dto/task-response.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller({ path: 'tasks', version: API_VERSION })
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() createTaskDto: CreateTaskDto): Promise<TaskResponseDto> {
    return TaskResponseDto.from(await this.tasksService.create(createTaskDto));
  }

  @Get()
  async findAll(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<TaskResponseDto>> {
    const page = await this.tasksService.findAll(query);
    return { ...page, data: TaskResponseDto.fromMany(page.data) };
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponseDto> {
    return TaskResponseDto.from(await this.tasksService.findOne(id));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return TaskResponseDto.from(
      await this.tasksService.update(id, updateTaskDto),
    );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tasksService.remove(id);
  }
}
