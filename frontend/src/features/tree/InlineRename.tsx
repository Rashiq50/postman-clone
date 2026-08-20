import { useRef, type KeyboardEvent } from 'react'

/**
 * One shared rename input for all three node types, so their semantics cannot
 * drift apart: Enter commits, Escape reverts, blur commits.
 *
 * Escape sets a ref *before* blurring, because the blur handler fires either
 * way and would otherwise commit the very edit Escape just cancelled.
 */
export function InlineRename({
  initialValue,
  onCommit,
  onCancel,
  depth,
}: {
  initialValue: string
  onCommit: (name: string) => void
  onCancel: () => void
  depth: number
}) {
  const cancelled = useRef(false)

  const commit = (value: string) => {
    const trimmed = value.trim()
    // An empty name would be rejected by the server anyway; treating it as a
    // cancel is kinder than a toast about it.
    if (trimmed.length === 0 || trimmed === initialValue) onCancel()
    else onCommit(trimmed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit(event.currentTarget.value)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelled.current = true
      event.currentTarget.blur()
    }
  }

  return (
    <input
      autoFocus
      defaultValue={initialValue}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={handleKeyDown}
      onBlur={(e) => {
        if (cancelled.current) onCancel()
        else commit(e.currentTarget.value)
      }}
      style={{ paddingLeft: 8 + depth * 14 }}
      className="w-full rounded-md border border-accent bg-surface py-1 pr-2 text-sm outline-none"
    />
  )
}
