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
      className="mb-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
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
                ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
            }`}
          />
          {fields.title && (
            <p className="mt-1 text-xs text-red-600">{fields.title}</p>
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
                ? 'border-red-400 focus:border-red-500 focus:ring-red-200'
                : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-200'
            }`}
          />
          {fields.description && (
            <p className="mt-1 text-xs text-red-600">{fields.description}</p>
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading || !title.trim()}
          className="h-[38px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? 'Adding…' : 'Add task'}
        </button>
      </div>

      {error && (
        <p className="mt-2 text-sm text-red-600">
          {errorMessage(error, 'Could not reach the server. Check your connection.')}
          {apiError && (
            <span className="ml-2 font-mono text-xs text-slate-400">
              {apiError.code} · {apiError.requestId.slice(0, 8)}
            </span>
          )}
        </p>
      )}
    </form>
  )
}
