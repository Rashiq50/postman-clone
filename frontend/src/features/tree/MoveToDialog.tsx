import { useState } from 'react'
import type { MoveTarget } from './moveTargets'

/**
 * "Move to…" — the kebab-menu path that stands in for drag-and-drop.
 *
 * No dnd library is installed, and hand-rolling HTML5 drag over a nested tree
 * (drop-target hit testing, "between" versus "into", auto-scroll,
 * auto-expand-on-hover) is a slice of its own. The `/move` endpoints are what
 * both approaches call, so drag-and-drop later is a pure-frontend change
 * against the same API.
 */
export function MoveToDialog({
  title,
  targets,
  currentParentId,
  onMove,
  onClose,
}: {
  title: string
  targets: MoveTarget[]
  currentParentId: string | null
  onMove: (target: MoveTarget) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string>(
    () => targets.find((t) => t.id === currentParentId)?.id ?? targets[0]?.id ?? '',
  )

  const chosen =
    targets.find((t) => (t.id ?? '') === selected) ?? targets[0]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-medium text-slate-900">{title}</h2>

        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          size={Math.min(10, Math.max(3, targets.length))}
          className="w-full rounded-md border border-slate-300 p-1 text-sm outline-none focus:border-indigo-500"
        >
          {targets.map((target) => (
            <option key={`${target.collectionId}:${target.id}`} value={target.id ?? ''}>
              {target.label}
            </option>
          ))}
        </select>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!chosen}
            onClick={() => chosen && onMove(chosen)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
