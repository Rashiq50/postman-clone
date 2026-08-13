import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Paginated } from '@postman-clone/contracts';
import { Repository } from 'typeorm';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { paginated } from '../common/pagination';
import { UserEntity } from '../users/entities/user.entity';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { Task } from './entities/task.entity';

/**
 * Every method takes `ownerId` and folds it into the SQL rather than checking
 * ownership after the fact. Two reasons: a row belonging to someone else is
 * never loaded into memory in the first place, and there is no window between
 * "read" and "check" for the answer to change.
 *
 * `ownerId` always originates from the verified token (see `JwtAuthGuard`),
 * never from a route param or request body.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task)
    private readonly tasksRepository: Repository<Task>,
  ) {}

  create(ownerId: string, createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.tasksRepository.create({
      ...createTaskDto,
      owner: { id: ownerId } as UserEntity,
    });
    return this.tasksRepository.save(task);
  }

  async findAll(
    ownerId: string,
    query: PaginationQueryDto,
  ): Promise<Paginated<Task>> {
    const { page, limit } = query;
    const [tasks, total] = await this.tasksRepository.findAndCount({
      where: { owner: { id: ownerId } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return paginated(tasks, total, page, limit);
  }

  async findOne(ownerId: string, id: string): Promise<Task> {
    const task = await this.tasksRepository.findOne({
      where: { id, owner: { id: ownerId } },
    });
    if (!task) {
      // 404, not 403, when the task exists but belongs to someone else.
      // Distinguishing the two would confirm the id is real, letting anyone
      // enumerate which tasks exist across the whole system.
      throw new NotFoundException(`Task with id "${id}" not found`);
    }
    return task;
  }

  async update(
    ownerId: string,
    id: string,
    updateTaskDto: UpdateTaskDto,
  ): Promise<Task> {
    const task = await this.findOne(ownerId, id);
    Object.assign(task, updateTaskDto);
    return this.tasksRepository.save(task);
  }

  async remove(ownerId: string, id: string): Promise<void> {
    // A single guarded DELETE rather than find-then-delete: the ownership test
    // and the write happen in one statement.
    const result = await this.tasksRepository
      .createQueryBuilder()
      .delete()
      .from(Task)
      .where('"id" = :id AND "ownerId" = :ownerId', { id, ownerId })
      .execute();

    if (!result.affected) {
      throw new NotFoundException(`Task with id "${id}" not found`);
    }
  }
}
