import type { SessionSummary } from '@postman-clone/contracts'
import { useState } from 'react'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useRevokeSessionMutation } from './sessionsApi'

/** Small local formatter — not worth a date library for one label. */
function relativeTime(iso: string | null): string {
  if (!iso) return 'never used'

  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'

  const units: [limit: number, size: number, name: string][] = [
    [3600, 60, 'minute'],
    [86400, 3600, 'hour'],
    [2592000, 86400, 'day'],
    [Infinity, 2592000, 'month'],
  ]

  for (const [limit, size, name] of units) {
    if (seconds < limit) {
      const value = Math.floor(seconds / size)
      return `${value} ${name}${value === 1 ? '' : 's'} ago`
    }
  }

  return 'a long time ago'
}

export function SessionItem({ session }: { session: SessionSummary }) {
  const [revokeSession, { isLoading }] = useRevokeSessionMutation()
  const [confirming, setConfirming] = useState(false)

  function handleRevoke() {
    // Revoking your own session correctly cascades into a logout, but that
    // should not be a surprise click. Revoking another device needs no
    // confirmation — it is undoable by signing in again there.
    if (session.current) setConfirming(true)
    else void revokeSession(session.id)
  }

  return (
    <li className="flex items-center gap-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
      {confirming && (
        <ConfirmDialog
          title="Sign out of this device?"
          message="You will be returned to the login page."
          confirmLabel="Sign out"
          danger
          onConfirm={() => void revokeSession(session.id)}
          onClose={() => setConfirming(false)}
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-fg">
          {session.userAgent ?? 'Unknown device'}
        </p>
        <p className="truncate text-sm text-fg-subtle">
          {session.ipAddress ?? 'Unknown address'} ·{' '}
          {relativeTime(session.lastUsedAt ?? session.createdAt)}
        </p>
      </div>

      {session.current && (
        <span className="hidden rounded-full bg-success-soft px-2.5 py-1 text-xs font-medium text-success-soft-fg sm:inline">
          This device
        </span>
      )}

      <button
        type="button"
        onClick={handleRevoke}
        disabled={isLoading}
        className="rounded-md px-2 py-1.5 text-sm font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
      >
        {session.current ? 'Sign out' : 'Revoke'}
      </button>
    </li>
  )
}
