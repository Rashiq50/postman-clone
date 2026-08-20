/**
 * Persistence for the sidebar's expansion set — which collections and folders
 * are open — keyed per workspace.
 *
 * ⚠️ This is the second thing the app stores, after the theme preference, and
 * it is allowed for the same reason: it is a *view* setting, not a credential.
 * The rule in `authSlice` is about the access token; nothing here identifies
 * anyone or grants anything, and an expansion set that resets on every reload
 * is a bug rather than a safety property. Nothing else may join it without the
 * same argument — in particular no part of the tree's *data* belongs here, or
 * the cache gains a second source of truth that no reconcile ever trues up.
 *
 * What is stored is the **expanded** ids, not the collapsed ones. A node the
 * user has never seen is therefore closed by default, and a workspace nobody
 * has opened costs no storage at all — the inverse would have to enumerate the
 * whole tree to say anything.
 */

const PREFIX = 'pc.tree.expanded.'

/**
 * ⚠️ Ids of deleted nodes are never removed by anything else, so without a cap
 * this key grows for the life of the browser profile. Pruning against the tree
 * would mean walking every node on every cache patch — the exact cost Phase 1–3
 * of the scale work removed — whereas a stale id is inert: `isExpanded` answers
 * true for a row that no longer renders. So it is bounded rather than cleaned.
 * `Set` preserves insertion order and `toggle` re-inserts on every open, so the
 * tail is the most recently opened and the head is what to drop.
 */
const MAX_IDS = 2000

/** Coalesces every change in a burst into one write, and keeps `JSON.stringify`
 *  off the click that caused it. Interactions are user-paced, so this is about
 *  the deep-link path, where `expandAll` opens a whole ancestor chain at once. */
const WRITE_DELAY_MS = 250

const keyFor = (workspaceId: string) => PREFIX + workspaceId

export function loadExpanded(workspaceId: string): string[] {
  if (!workspaceId) return []
  try {
    const raw = localStorage.getItem(keyFor(workspaceId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    // Anything can be in `localStorage` — another version of this app, a user
    // with devtools open. A malformed value reads as "nothing was open", which
    // is the same as a first visit and needs no error path.
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * Debounced writer, one per workspace key. Returns a `save` to call on every
 * change and a `flush` for teardown, so a toggle immediately before a route
 * change or a tab close is not lost.
 */
export function createExpansionWriter(workspaceId: string): {
  save: (ids: Iterable<string>) => void
  flush: () => void
} {
  if (!workspaceId) return { save: () => {}, flush: () => {} }

  let pending: string[] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const write = () => {
    timer = null
    const ids = pending
    pending = null
    if (!ids) return
    try {
      const capped = ids.length > MAX_IDS ? ids.slice(ids.length - MAX_IDS) : ids
      localStorage.setItem(keyFor(workspaceId), JSON.stringify(capped))
    } catch {
      // Full quota, or Safari's private mode, which throws on `setItem`. The
      // sidebar still works; it just forgets. Never worth breaking a click for.
    }
  }

  return {
    save: (ids) => {
      pending = [...ids]
      if (timer === null) timer = setTimeout(write, WRITE_DELAY_MS)
    },
    flush: () => {
      if (timer !== null) clearTimeout(timer)
      write()
    },
  }
}
