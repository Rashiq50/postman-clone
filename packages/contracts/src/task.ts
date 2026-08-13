/**
 * Task status values.
 *
 * Deliberately a const object rather than a TS `enum`: the frontend compiles
 * with `erasableSyntaxOnly`, which bans enums, and TypeORM / class-validator
 * both accept a plain object here.
 */
export const TaskStatus = {
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TASK_STATUSES: readonly TaskStatus[] = Object.values(TaskStatus);

/** A task as it appears on the wire. Dates are ISO 8601 strings, not `Date`. */
export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
}

export type UpdateTaskInput = Partial<CreateTaskInput>;
