import { useState, useSyncExternalStore } from 'react'

/**
 * The sidebar's own view state — which nodes are open, which one is being
 * renamed, which request is active — as **one external store per `Sidebar`**
 * rather than as React state threaded down the tree.
 *
 * ⚠️ This is a performance decision, and the only reason it is not plain
 * `useState`. At a few hundred collections the tree has thousands of mounted
 * rows, and any of these three values held as state in `Sidebar` re-renders
 * *every* one of them on every chevron click: the value has to reach a leaf
 * somehow, and whatever prop or context carries it changes identity, which
 * defeats `React.memo` on every node in between. With a store, the identity
 * that reaches the leaves — the store object — never changes; each row
 * subscribes for itself through `useSyncExternalStore` and re-renders only when
 * the *boolean it actually reads* flips. A toggle then re-renders the toggled
 * row and the subtree it mounts, and nothing else.
 *
 * The same reasoning as elsewhere in this app applies to what is *not* here:
 * this is not Redux (an action per chevron click for state nothing outside the
 * sidebar reads), and it is not persisted (expansion resets on reload — an
 * accepted trade-off, said out loud).
 *
 * Expansion is still one `Set` at `Sidebar` level rather than per-node state:
 * collapsing a parent unmounts its children, so per-node state would be
 * destroyed and reopening the parent would show every grandchild collapsed.
 */
export interface TreeUiStore {
  subscribe: (listener: () => void) => () => void
  isExpanded: (id: string) => boolean
  toggle: (id: string) => void
  /** Opens a whole ancestor chain at once, so a deep link lands visible. */
  expandAll: (ids: readonly string[]) => void
  isRenaming: (id: string) => boolean
  startRename: (id: string | null) => void
  isActiveRequest: (id: string) => boolean
  setActiveRequest: (id: string | undefined) => void
}

export function createTreeUiStore(): TreeUiStore {
  const expanded = new Set<string>()
  let renamingId: string | null = null
  let activeRequestId: string | undefined

  const listeners = new Set<() => void>()
  // Every listener is called on every change and each one compares its own
  // boolean; React drops the ones that did not move. That is O(mounted rows)
  // per toggle in cheap function calls, against O(mounted rows) in React
  // renders without it.
  const notify = () => listeners.forEach((listener) => listener())

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    isExpanded: (id) => expanded.has(id),

    toggle: (id) => {
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      notify()
    },

    expandAll: (ids) => {
      let changed = false
      for (const id of ids) {
        if (!expanded.has(id)) {
          expanded.add(id)
          changed = true
        }
      }
      if (changed) notify()
    },

    isRenaming: (id) => renamingId === id,

    startRename: (id) => {
      if (renamingId === id) return
      renamingId = id
      notify()
    },

    isActiveRequest: (id) => activeRequestId === id,

    setActiveRequest: (id) => {
      if (activeRequestId === id) return
      activeRequestId = id
      notify()
    },
  }
}

/** One store per mounted `Sidebar`, stable for its lifetime. */
export function useTreeUiStore(): TreeUiStore {
  const [store] = useState(createTreeUiStore)
  return store
}

export function useIsExpanded(ui: TreeUiStore, id: string): boolean {
  return useSyncExternalStore(ui.subscribe, () => ui.isExpanded(id))
}

export function useIsRenaming(ui: TreeUiStore, id: string): boolean {
  return useSyncExternalStore(ui.subscribe, () => ui.isRenaming(id))
}

export function useIsActiveRequest(ui: TreeUiStore, id: string): boolean {
  return useSyncExternalStore(ui.subscribe, () => ui.isActiveRequest(id))
}
