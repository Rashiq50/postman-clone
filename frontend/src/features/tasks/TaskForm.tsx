import { useState, type FormEvent } from 'react'
import { errorMessage, fieldErrors, toApiError } from '../../lib/api-error'
import { useCreateTaskMutation } from './tasksApi'

export function TaskForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [createTask, { isLoading, error }] = useCreateTaskMutation()

  const fields = fieldErrors(error)
  const apiError = toApiError(error)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    try {
      await createTask({
        title: trimmedTitle,
        description: description.trim() || undefined,
      }).unwrap()
      setTitle('')
      setDescription('')
    } catch {
      // Surfaced through `error` below.
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-6 rounded-lg border border-line bg-surface p-4 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            aria-invalid={Boolean(fields.title)}
            className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
              fields.title
                ? 'border-danger focus:ring-focus-danger'
                : 'border-line-strong focus:border-accent focus:ring-focus'
            }`}
          />
          {fields.title && (
            <p className="mt-1 text-xs text-danger">{fields.title}</p>
          )}
        </div>
        <div className="flex-1">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            aria-invalid={Boolean(fields.description)}
            className={`w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 ${
              fields.description
                ? 'border-danger focus:ring-focus-danger'
                : 'border-line-strong focus:border-accent focus:ring-focus'
            }`}
          />
          {fields.description && (
            <p className="mt-1 text-xs text-danger">{fields.description}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading || !title.trim()}
          className="h-[38px] rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-disabled"
        >
          {isLoading ? 'Adding…' : 'Add task'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-danger">
          {errorMessage(error, 'Could not reach the server. Check your connection.')}
          {apiError && (
            <span className="ml-2 font-mono text-xs text-fg-faint">
              {apiError.code} · {apiError.requestId.slice(0, 8)}
            </span>
          )}
        </p>
      )}
    </form>
  )
}
