import { useCallback, useState } from 'react'

/**
 * Which nodes are open, as one `Set<string>` held **at `Sidebar` level**.
 *
 * Not per-node state: collapsing a parent unmounts its children, so their own
 * state would be destroyed and reopening the parent would show every
 * grandchild collapsed again.
 *
 * Not Redux: this is an action dispatch per chevron click for state nothing
 * outside the sidebar reads.
 *
 * Not `localStorage`: expansion resets on reload, and that is an accepted
 * trade-off worth saying out loud rather than a bug. This codebase keeps no
 * persisted second source of truth, and slice 1 does not need one.
 */
export function useExpanded() {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /** Opens a whole ancestor chain at once, so a deep link lands visible. */
  const expandAll = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    setExpanded((current) => {
      if (ids.every((id) => current.has(id))) return current
      const next = new Set(current)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])

  const isExpanded = useCallback(
    (id: string) => expanded.has(id),
    [expanded],
  )

  return { isExpanded, toggle, expandAll }
}
