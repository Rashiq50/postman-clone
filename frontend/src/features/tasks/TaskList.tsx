import { useGetTasksQuery } from './tasksApi'
import { TaskItem } from './TaskItem'

export function TaskList() {
  const { data: tasks, isLoading, isError, refetch } = useGetTasksQuery()

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading tasks…</p>
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-700">
          Could not reach the API. Is the backend running on port 3000?
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-2 text-sm font-medium text-red-700 underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!tasks?.length) {
    return (
      <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
        No tasks yet. Add your first one above.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} />
      ))}
    </ul>
  )
}
