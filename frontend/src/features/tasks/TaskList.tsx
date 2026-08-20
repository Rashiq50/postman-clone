import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@postman-clone/contracts'
import { useState } from 'react'
import { errorMessage, toApiError } from '../../lib/api-error'
import { TaskItem } from './TaskItem'
import { useGetTasksQuery } from './tasksApi'

export function TaskList() {
  const [page, setPage] = useState(DEFAULT_PAGE)
  const { data, error, isLoading, isError, isFetching, refetch } =
    useGetTasksQuery({ page, limit: DEFAULT_PAGE_SIZE })

  if (isLoading) {
    return <p className="text-sm text-fg-subtle">Loading tasks…</p>
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-danger-line bg-danger-soft p-4">
        <p className="text-sm text-danger-soft-fg">
          {errorMessage(
            error,
            'Could not reach the API. Is the backend running on port 3000?',
          )}
        </p>
        {toApiError(error) && (
          <p className="mt-1 font-mono text-xs text-danger">
            {toApiError(error)?.code} · request {toApiError(error)?.requestId}
          </p>
        )}
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-2 text-sm font-medium text-danger-soft-fg underline"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data || data.data.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-fg-subtle">
        No tasks yet. Add your first one above.
      </p>
    )
  }

  const { data: tasks, meta } = data

  return (
    <>
      <ul className="flex flex-col gap-3">
        {tasks.map((task) => (
          <TaskItem key={task.id} task={task} />
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between text-sm text-fg-subtle">
        <span>
          Page {meta.page} of {meta.totalPages} · {meta.total} task
          {meta.total === 1 ? '' : 's'}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={meta.page <= 1 || isFetching}
            className="rounded-md border border-line-strong px-3 py-1.5 transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={meta.page >= meta.totalPages || isFetching}
            className="rounded-md border border-line-strong px-3 py-1.5 transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </>
  )
}
