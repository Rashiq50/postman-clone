import { useCallback, useRef } from 'react'

export interface Snapshot {
  value: string
  caret: number
}

/** Bounded so a long editing session cannot grow without limit. */
const MAX_DEPTH = 100

/** Edits closer together than this coalesce into one undo step. */
const COALESCE_MS = 500

/**
 * A minimal undo/redo history for `VariableInput`.
 *
 * ⚠️ **This exists because the repaint destroys the browser's own history.**
 * Assigning `innerHTML` on every keystroke — which is what draws the chips —
 * clears the native undo stack of a `contenteditable`, so Ctrl+Z would
 * otherwise do nothing at all. Silently losing undo is a real regression
 * against the plain `<input>` this replaces, and it is invisible until someone
 * needs it, which is the worst time to find out.
 *
 * Granularity is by pause, not by keystroke: a burst of typing records one
 * snapshot, so undo removes a word rather than a letter, the way a native field
 * behaves.
 */
export function useUndoStack() {
  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const lastRecordedAt = useRef(0)

  /** Call with the state as it was *before* the edit being made. */
  const record = useCallback((previous: Snapshot) => {
    const now = Date.now()
    if (
      undoStack.current.length === 0 ||
      now - lastRecordedAt.current > COALESCE_MS
    ) {
      undoStack.current.push(previous)
      if (undoStack.current.length > MAX_DEPTH) undoStack.current.shift()
      lastRecordedAt.current = now
    }
    // Any new edit forks the timeline: what was undone is no longer reachable.
    redoStack.current = []
  }, [])

  const undo = useCallback((current: Snapshot): Snapshot | null => {
    const snapshot = undoStack.current.pop()
    if (!snapshot) return null
    redoStack.current.push(current)
    // Force the next edit to start a fresh step rather than coalescing into
    // the one that was just undone.
    lastRecordedAt.current = 0
    return snapshot
  }, [])

  const redo = useCallback((current: Snapshot): Snapshot | null => {
    const snapshot = redoStack.current.pop()
    if (!snapshot) return null
    undoStack.current.push(current)
    lastRecordedAt.current = 0
    return snapshot
  }, [])

  /** Dropped when a different request is opened — that is not an edit. */
  const clear = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    lastRecordedAt.current = 0
  }, [])

  return { record, undo, redo, clear }
}
