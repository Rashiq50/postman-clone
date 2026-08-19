import type {
  Task as TaskContract,
  TaskStatus,
} from '@postman-clone/contracts';
import { Expose, Transform, plainToInstance } from 'class-transformer';
import { Task } from '../entities/task.entity';

/**
 * The serialization boundary between the database and the wire.
 *
 * Entities are never returned from a controller directly. Everything here is
 * opt-in via `@Expose()` and built with `excludeExtraneousValues`, so a column
 * added to the entity tomorrow — a password hash, an internal flag, a soft
 * delete timestamp — is dropped by default instead of leaking.
 *
 * `implements TaskContract` makes the shared contract compile-time enforced:
 * if this and packages/contracts disagree, the build fails.
 */
export class TaskResponseDto implements TaskContract {
  @Expose()
  id: string;

  @Expose()
  title: string;

  @Expose()
  description: string | null;

  @Expose()
  status: TaskStatus;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  createdAt: string;

  @Expose()
  @Transform(({ value }: { value: unknown }) =>
    value instanceof Date ? value.toISOString() : value,
  )
  updatedAt: string;

  static from(task: Task): TaskResponseDto {
    return plainToInstance(TaskResponseDto, task, {
      excludeExtraneousValues: true,
    });
  }

  static fromMany(tasks: Task[]): TaskResponseDto[] {
    return tasks.map((task) => TaskResponseDto.from(task));
  }
}
