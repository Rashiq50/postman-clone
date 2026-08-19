import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@postman-clone/contracts'
import { useState } from 'react'
import { useLogoutAllMutation } from '../auth/authApi'
import { errorMessage, toApiError } from '../../lib/api-error'
import { SessionItem } from './SessionItem'
import { useListSessionsQuery } from './sessionsApi'

export function SessionsPage() {
  const [page, setPage] = useState(DEFAULT_PAGE)
  const { data, error, isLoading, isError, isFetching, refetch } =
    useListSessionsQuery({ page, limit: DEFAULT_PAGE_SIZE })
  const [logoutAll, { isLoading: isLoggingOutAll }] = useLogoutAllMutation()

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Sessions</h1>
          <p className="text-sm text-slate-500">
            Devices currently signed in to your account
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logoutAll()}
          disabled={isLoggingOutAll}
          className="h-[38px] rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoggingOutAll ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </header>

      {isLoading && <p className="text-sm text-slate-500">Loading sessions…</p>}

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {errorMessage(
              error,
              'Could not reach the API. Is the backend running on port 3000?',
            )}
          </p>
          {toApiError(error) && (
            <p className="mt-1 font-mono text-xs text-red-500">
              {toApiError(error)?.code} · request {toApiError(error)?.requestId}
            </p>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-red-700 underline"
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && (!data || data.data.length === 0) && (
        <p className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No active sessions.
        </p>
      )}

      {!isError && data && data.data.length > 0 && (
        <>
          <ul className="flex flex-col gap-3">
            {data.data.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total}{' '}
              session{data.meta.total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.meta.page <= 1 || isFetching}
                className="rounded-md border border-slate-300 px-3 py-1.5 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={data.meta.page >= data.meta.totalPages || isFetching}
                className="rounded-md border border-slate-300 px-3 py-1.5 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
