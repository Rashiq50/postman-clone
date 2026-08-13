export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const

export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export interface CreateTaskInput {
  title: string
  description?: string
  status?: TaskStatus
}

export type UpdateTaskInput = Partial<CreateTaskInput>
