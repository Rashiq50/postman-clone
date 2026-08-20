import { useEffect, useState, useSyncExternalStore } from 'react'
import { createExpansionWriter, loadExpanded } from './treeExpansion'

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
 * sidebar reads).
 *
 * Expansion *is* persisted, per workspace — see [treeExpansion.ts](./treeExpansion.ts)
 * for what that is allowed to hold and why. Renaming and the active request are
 * not: the first is a transient mode and the second already lives in the URL,
 * which is the thing a reload restores.
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
  /** Writes any debounced expansion change out now. Call on teardown. */
  flush: () => void
}

/**
 * ⚠️ The persisted set is read **synchronously here**, during the render that
 * creates the store — not in an effect. An effect runs after the first paint,
 * so the tree would paint fully collapsed and then pop open, the same one-frame
 * flash that the theme's inline script in `index.html` exists to avoid.
 */
export function createTreeUiStore(workspaceId = ''): TreeUiStore {
  const expanded = new Set<string>(loadExpanded(workspaceId))
  const writer = createExpansionWriter(workspaceId)
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
      // Delete-then-add on reopen is deliberate: it moves the id to the end of
      // the `Set`'s insertion order, which is the recency the write cap prunes
      // against.
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      writer.save(expanded)
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
      // Only on a real change: `expandAll` runs from an effect on every tree
      // identity change, and an unconditional save would write on every
      // background refetch.
      if (changed) {
        writer.save(expanded)
        notify()
      }
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

    flush: writer.flush,
  }
}

/**
 * One store per workspace, stable for as long as the id is.
 *
 * ⚠️ It is rebuilt when `workspaceId` changes rather than on mount only:
 * `Sidebar` is not remounted when the route moves between workspaces, so a
 * store built once would keep answering — and persisting — with the previous
 * workspace's expansion set under the previous workspace's key.
 */
export function useTreeUiStore(workspaceId = ''): TreeUiStore {
  const [state, setState] = useState(() => ({
    id: workspaceId,
    store: createTreeUiStore(workspaceId),
  }))

  let current = state
  if (state.id !== workspaceId) {
    // Render-phase reset: the store must exist before the children of *this*
    // render read it, and an effect would paint one frame of the wrong tree.
    state.store.flush()
    current = { id: workspaceId, store: createTreeUiStore(workspaceId) }
    setState(current)
  }

  // A toggle immediately before a tab close or a navigation away is inside the
  // debounce window; without this it is lost.
  useEffect(() => {
    const store = current.store
    const onHide = () => store.flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      store.flush()
    }
  }, [current.store])

  return current.store
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
