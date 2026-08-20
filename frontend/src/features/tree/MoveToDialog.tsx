import { useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from '../../components/ui/Dialog'
import type { MoveTarget } from './moveTargets'

/**
 * ⚠️ A target's identity is the **pair** (collection, folder), never the folder
 * id alone: every collection root has `id: null`, so keying on the id makes all
 * 500 of them the same option. That presented as several rows highlighted at
 * once, and — worse — as a root-level request in collection 300 pre-selecting
 * collection 1's root, one Enter away from a silent cross-collection move.
 */
const keyOf = (target: { collectionId: string; id: string | null }) =>
  `${target.collectionId}:${target.id ?? ''}`

/**
 * "Move to…" — the kebab-menu path that stands in for drag-and-drop.
 *
 * No dnd library is installed, and hand-rolling HTML5 drag over a nested tree
 * (drop-target hit testing, "between" versus "into", auto-scroll,
 * auto-expand-on-hover) is a slice of its own. The `/move` endpoints are what
 * both approaches call, so drag-and-drop later is a pure-frontend change
 * against the same API.
 *
 * The chrome — overlay, focus trap, Escape, outside press — is
 * [Dialog](../../components/ui/Dialog.tsx). This file is the destination list
 * and the two buttons.
 */
export function MoveToDialog({
  title,
  targets,
  currentParentId,
  currentCollectionId,
  onMove,
  onClose,
}: {
  title: string
  targets: MoveTarget[]
  currentParentId: string | null
  /** The collection the node is in today — half of its current target's key. */
  currentCollectionId: string
  onMove: (target: MoveTarget) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<string>(() => {
    const current = keyOf({ collectionId: currentCollectionId, id: currentParentId })
    return targets.some((t) => keyOf(t) === current)
      ? current
      : targets[0]
        ? keyOf(targets[0])
        : ''
  })
  const listRef = useRef<HTMLDivElement>(null)

  const at = targets.findIndex((t) => keyOf(t) === selected)
  const chosen = targets[at] ?? targets[0]

  // The current parent is usually far down a long list — open on it rather than
  // making the user find it. `block: 'center'` so its neighbours are visible,
  // which is the context that makes the choice meaningful.
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'center' })
  }, [])

  const step = (delta: number) => {
    const next = targets[Math.min(targets.length - 1, Math.max(0, at + delta))]
    if (!next) return
    setSelected(keyOf(next))
    listRef.current
      ?.querySelector(`[data-target-key="${keyOf(next)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  return (
    // Mounted only while open, so `open` is a constant: `onOpenChange(false)`
    // is the single close path — Escape, the overlay and Cancel all arrive
    // through it, which is what stops one of the three from being forgotten.
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      footer={
        <>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction
            disabled={!chosen}
            onClick={() => chosen && onMove(chosen)}
          >
            Move
          </DialogPrimaryAction>
        </>
      }
    >
      {/*
        ⚠️ A hand-rolled listbox rather than a sized `<select>`, and the reason
        is the theme: an `<option>` is painted by the platform, not by CSS —
        Chrome renders the rows opaque white whatever the element's
        `background-color` and `color-scheme` say, so on Dark and Midnight the
        list was a white slab in a dark dialog. That was the *only* surface in
        the app that ignored the theme. Everything below is tokens.

        It also buys the indent back: depth is padding here, where in a
        `<select>` it had to be leading spaces baked into the label.
      */}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Destination"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); step(1) }
          else if (event.key === 'ArrowUp') { event.preventDefault(); step(-1) }
          else if (event.key === 'Home') { event.preventDefault(); step(-targets.length) }
          else if (event.key === 'End') { event.preventDefault(); step(targets.length) }
          // Enter confirms from the list, so the common case — arrow to the
          // destination, commit — never needs the mouse or a tab to the button.
          else if (event.key === 'Enter' && chosen) { event.preventDefault(); onMove(chosen) }
        }}
        className="max-h-64 overflow-y-auto rounded-md border border-line-strong bg-surface py-1 text-sm outline-none focus:border-accent"
      >
        {targets.map((target) => {
          const isSelected = keyOf(target) === selected
          return (
            <div
              key={keyOf(target)}
              role="option"
              aria-selected={isSelected}
              data-target-key={keyOf(target)}
              onClick={() => setSelected(keyOf(target))}
              // Double-click commits, the way a file picker does.
              onDoubleClick={() => onMove(target)}
              style={{ paddingLeft: 8 + target.depth * 14 }}
              className={`cursor-default truncate py-1 pr-2 ${
                isSelected
                  ? 'bg-accent-soft text-accent-soft-fg'
                  : 'text-fg-muted hover:bg-surface-muted'
              }`}
            >
              {target.label}
            </div>
          )
        })}
      </div>
    </Dialog>
  )
}
