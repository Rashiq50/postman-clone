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
          <h1 className="text-2xl font-semibold text-fg">Sessions</h1>
          <p className="text-sm text-fg-subtle">
            Devices currently signed in to your account
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logoutAll()}
          disabled={isLoggingOutAll}
          className="h-[38px] rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-disabled"
        >
          {isLoggingOutAll ? 'Signing out…' : 'Sign out everywhere'}
        </button>
      </header>

      {isLoading && <p className="text-sm text-fg-subtle">Loading sessions…</p>}

      {isError && (
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
      )}

      {!isLoading && !isError && (!data || data.data.length === 0) && (
        <p className="rounded-lg border border-dashed border-line-strong p-8 text-center text-sm text-fg-subtle">
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

          <div className="mt-4 flex items-center justify-between text-sm text-fg-subtle">
            <span>
              Page {data.meta.page} of {data.meta.totalPages} · {data.meta.total}{' '}
              session{data.meta.total === 1 ? '' : 's'}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={data.meta.page <= 1 || isFetching}
                className="rounded-md border border-line-strong px-3 py-1.5 transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={data.meta.page >= data.meta.totalPages || isFetching}
                className="rounded-md border border-line-strong px-3 py-1.5 transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
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
