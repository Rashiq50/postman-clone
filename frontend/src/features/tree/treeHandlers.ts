import type { MenuItem } from './NodeMenu'
import type { TreeUiStore } from './treeUi'

export type NodeKind = 'collection' | 'folder' | 'request'

/**
 * What every node view needs to render itself and its subtree.
 *
 * ⚠️ **This object must be referentially stable** — `Sidebar` builds it with
 * `useMemo` and every node view is `React.memo`'d on it. A new identity here
 * re-renders every mounted row, which is exactly the cost the memoization
 * exists to remove. That is why the changing values (expansion, the node being
 * renamed, the active request) live behind `ui`, a store whose identity never
 * changes, rather than as fields on this object.
 */
export interface TreeHandlers {
  ui: TreeUiStore
  cancelRename: () => void
  commitRename: (kind: NodeKind, id: string, name: string) => void
  openRequest: (id: string) => void
  /**
   * Built at menu-*open* time, never during render: a `MenuItem[]` per mounted
   * row per render was the largest allocation in this tree, and the items are
   * only ever read by a menu the user has opened.
   */
  menuFor: (
    kind: NodeKind,
    node: { id: string; name: string },
    context: MenuContext,
  ) => MenuItem[]
}

export interface MenuContext {
  collectionId: string
  /**
   * ⚠️ The node's slot among its siblings as **two numbers, not the sibling
   * array**. A patch anywhere in a collection gives every array on the path to
   * it a new identity, so passing `node.folders` (or `tree.collections`) as a
   * prop would fail the `React.memo` comparison on every sibling row for an
   * edit that did not touch them. Two primitives compare equal.
   */
  index: number
  siblingCount: number
  /**
   * The node's current parent folder (`parentFolderId` / `folderId`), which the
   * reorder items have to send back to the server. It comes from the node
   * itself rather than from a walk of the tree — that walk used to run in
   * `Sidebar` and was the only thing keeping the whole tree in the menu's
   * closure.
   */
  parentId: string | null
}
