import {
  TASK_STATUSES,
  type Task,
  type TaskStatus,
} from '@postman-clone/contracts'
import { useDeleteTaskMutation, useUpdateTaskMutation } from './tasksApi'

const statusStyles: Record<TaskStatus, string> = {
  TODO: 'bg-slate-100 text-slate-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  DONE: 'bg-emerald-100 text-emerald-800',
}

export function TaskItem({ task }: { task: Task }) {
  const [updateTask, { isLoading: isUpdating }] = useUpdateTaskMutation()
  const [deleteTask, { isLoading: isDeleting }] = useDeleteTaskMutation()

  return (
    <li className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{task.title}</p>
        {task.description && (
          <p className="truncate text-sm text-slate-500">{task.description}</p>
        )}
      </div>

      <span
        className={`hidden rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${statusStyles[task.status]}`}
      >
        {task.status.replace('_', ' ')}
      </span>

      <select
        value={task.status}
        disabled={isUpdating}
        onChange={(e) =>
          updateTask({
            id: task.id,
            changes: { status: e.target.value as TaskStatus },
          })
        }
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
      >
        {TASK_STATUSES.map((status) => (
          <option key={status} value={status}>
            {status.replace('_', ' ')}
          </option>
        ))}
      </select>

      <button
        type="button"
        onClick={() => deleteTask(task.id)}
        disabled={isDeleting}
        className="rounded-md px-2 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
      >
        Delete
      </button>
    </li>
  )
}
