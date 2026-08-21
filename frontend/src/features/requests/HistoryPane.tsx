import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useState } from 'react'
import { methodStyles } from '../tree/methodStyles'
import {
  useClearExecutionsMutation,
  useGetExecutionsQuery,
} from './executionsApi'
import { failureStyle, formatDuration, statusStyle } from './statusStyles'

/** `just now`, `3m ago`, `2h ago`, `5d ago`. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

/**
 * The per-request send history.
 *
 * Rows carry no body — the list endpoint deliberately omits it — so opening a
 * past run is a second request, by its own id. Selecting one puts the response
 * pane into "viewing a past run" mode behind a `warning-soft` banner; see
 * `ResponsePane`.
 */
export function HistoryPane({
  requestId,
  selectedId,
  onSelect,
}: {
  requestId: string
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { data, isLoading } = useGetExecutionsQuery({ requestId })
  const [clearExecutions, { isLoading: isClearing }] =
    useClearExecutionsMutation()
  const [confirming, setConfirming] = useState(false)

  const rows = data?.data ?? []

  if (isLoading) {
    return <p className="p-4 text-sm text-fg-faint">Loading history…</p>
  }

  if (rows.length === 0) {
    return (
      <p className="p-4 text-sm text-fg-faint">
        No sends recorded for this request yet.
      </p>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-xs text-fg-faint">
          {data?.meta.total} recorded run
          {data?.meta.total === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          disabled={isClearing}
          onClick={() => setConfirming(true)}
          className="rounded px-1.5 py-0.5 text-xs text-danger transition hover:bg-danger-soft disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              className={`flex w-full items-center gap-2 border-t border-line-subtle px-3 py-1.5 text-left text-xs transition hover:bg-surface-muted ${
                row.id === selectedId ? 'bg-accent-soft' : ''
              }`}
            >
              <span
                className={`w-14 shrink-0 font-mono font-semibold ${methodStyles[row.method]}`}
              >
                {row.method}
              </span>

              {row.outcome === 'response' && row.status !== null ? (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-semibold tabular-nums ${statusStyle(row.status)}`}
                >
                  {row.status}
                </span>
              ) : (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-semibold ${failureStyle}`}
                >
                  {row.failureKind}
                </span>
              )}

              <span className="min-w-0 flex-1 truncate font-mono text-fg-subtle">
                {row.url}
              </span>

              {row.usedDraft && (
                <span
                  title="Sent with unsaved edits"
                  className="shrink-0 rounded bg-warning-soft px-1.5 py-0.5 font-medium text-warning-soft-fg"
                >
                  draft
                </span>
              )}

              <span className="w-14 shrink-0 text-right tabular-nums text-fg-faint">
                {formatDuration(row.durationMs)}
              </span>
              <span className="w-16 shrink-0 text-right text-fg-faint">
                {relativeTime(row.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {confirming && (
        <ConfirmDialog
          title="Clear history"
          message="Delete every recorded run for this request? This cannot be undone, and history is shared with everyone in the workspace."
          confirmLabel="Clear history"
          danger
          onConfirm={() => void clearExecutions({ requestId })}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  )
}
