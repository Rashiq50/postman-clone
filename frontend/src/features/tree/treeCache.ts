import type {
  ApiRequest,
  Collection,
  CollectionNode,
  Folder,
  FolderNode,
  HttpMethod,
  RequestNode,
  WorkspaceTree,
} from '@raven/contracts'

/**
 * Pure edits to a cached `WorkspaceTree`.
 *
 * Every function here runs as an immer recipe inside
 * `treeApi.util.updateQueryData('getTree', workspaceId, draft => …)`, which is
 * what replaces the whole-tree refetch that used to follow every structural
 * mutation. At a few hundred collections that refetch is a multi-hundred-
 * millisecond stall on an action the user is looking at; a patch is memory
 * speed.
 *
 * ⚠️ **They are deliberately total and silent.** A miss — an id that is not in
 * the cache — is a no-op, never a throw. The cache can legitimately be behind
 * the server (another tab, another member, a create whose response has not
 * landed yet), and the answer to that is the background reconcile
 * (`refetchOnFocus` on `getTree`), not an exception thrown from inside a
 * reducer.
 *
 * ⚠️ **Order in these arrays is the render order.** Nothing here re-sorts on
 * `position`, and nothing should: `positionForMove` on the backend renumbers an
 * entire sibling set when the 1024-wide gap is exhausted, so the `position`
 * numbers in a patched cache go stale while the *order* stays right. Splicing
 * by index keeps the sidebar correct through that; the reconcile trues the
 * numbers up later.
 */

export type NodeKind = 'collection' | 'folder' | 'request'

/** Where a node is being moved to. */
export type MoveDestination =
  /** Reorder among its current siblings — the container does not change. */
  | { kind: 'same' }
  /** The root of the node's *own* collection (a folder never changes collection). */
  | { kind: 'root' }
  | { kind: 'folder'; folderId: string }

type AnyNode = CollectionNode | FolderNode | RequestNode

interface Located {
  kind: NodeKind
  node: AnyNode
  /** The array the node currently sits in, and where in it. */
  siblings: AnyNode[]
  index: number
  /** The collection the node lives in — itself, for a collection. */
  collection: CollectionNode
}

// --------------------------------------------------------------- lookups

function findCollection(
  draft: WorkspaceTree,
  id: string,
): CollectionNode | undefined {
  return draft.collections.find((c) => c.id === id)
}

function findFolderIn(
  folders: FolderNode[],
  id: string,
): FolderNode | undefined {
  for (const folder of folders) {
    if (folder.id === id) return folder
    const deeper = findFolderIn(folder.folders, id)
    if (deeper) return deeper
  }
  return undefined
}

/** A folder anywhere in the workspace, with the collection holding it. */
function findFolder(
  draft: WorkspaceTree,
  id: string,
): { folder: FolderNode; collection: CollectionNode } | undefined {
  for (const collection of draft.collections) {
    const folder = findFolderIn(collection.folders, id)
    if (folder) return { folder, collection }
  }
  return undefined
}

/**
 * Where a node is, in one walk. Every mutating helper below goes through this
 * rather than repeating the traversal — the walk existed in three shapes across
 * `Sidebar` before and they were free to drift.
 */
function locate(draft: WorkspaceTree, id: string): Located | undefined {
  const collectionIndex = draft.collections.findIndex((c) => c.id === id)
  if (collectionIndex !== -1) {
    const collection = draft.collections[collectionIndex]
    return {
      kind: 'collection',
      node: collection,
      siblings: draft.collections,
      index: collectionIndex,
      collection,
    }
  }

  for (const collection of draft.collections) {
    const found = locateIn(collection.folders, collection.requests, id)
    if (found) return { ...found, collection }
  }
  return undefined
}

function locateIn(
  folders: FolderNode[],
  requests: RequestNode[],
  id: string,
): Omit<Located, 'collection'> | undefined {
  const folderIndex = folders.findIndex((f) => f.id === id)
  if (folderIndex !== -1) {
    return {
      kind: 'folder',
      node: folders[folderIndex],
      siblings: folders,
      index: folderIndex,
    }
  }

  const requestIndex = requests.findIndex((r) => r.id === id)
  if (requestIndex !== -1) {
    return {
      kind: 'request',
      node: requests[requestIndex],
      siblings: requests,
      index: requestIndex,
    }
  }

  for (const folder of folders) {
    const deeper = locateIn(folder.folders, folder.requests, id)
    if (deeper) return deeper
  }
  return undefined
}

// --------------------------------------------------------------- inserts

/**
 * Creates always append: the server computes `MAX + 1024`, so the new row is
 * last among its siblings by construction and the client never has to guess a
 * slot.
 */
export function insertCollection(
  draft: WorkspaceTree,
  collection: Collection,
): void {
  if (findCollection(draft, collection.id)) return
  draft.collections.push({
    id: collection.id,
    name: collection.name,
    description: collection.description,
    position: collection.position,
    folders: [],
    requests: [],
  })
}

export function insertFolder(draft: WorkspaceTree, folder: Folder): void {
  const collection = findCollection(draft, folder.collectionId)
  if (!collection) return

  const parent = folder.parentFolderId
    ? findFolderIn(collection.folders, folder.parentFolderId)
    : collection
  if (!parent) return
  if (findFolderIn(parent.folders, folder.id)) return

  parent.folders.push({
    id: folder.id,
    name: folder.name,
    parentFolderId: folder.parentFolderId,
    position: folder.position,
    folders: [],
    requests: [],
  })
}

export function insertRequest(draft: WorkspaceTree, request: ApiRequest): void {
  const collection = findCollection(draft, request.collectionId)
  if (!collection) return

  const parent = request.folderId
    ? findFolderIn(collection.folders, request.folderId)
    : collection
  if (!parent) return
  if (parent.requests.some((r) => r.id === request.id)) return

  parent.requests.push({
    id: request.id,
    name: request.name,
    method: request.method,
    folderId: request.folderId,
    position: request.position,
  })
}

// --------------------------------------------------------------- mutations

/** Removes a node of any kind. Returns what was removed, or `undefined`. */
export function removeNode(
  draft: WorkspaceTree,
  id: string,
): AnyNode | undefined {
  const found = locate(draft, id)
  if (!found) return undefined
  found.siblings.splice(found.index, 1)
  return found.node
}

/**
 * Re-parents and/or reorders a node. `index` is the 0-based slot among the
 * destination's children — the same thing the `/move` endpoints take —
 * and omitting it appends.
 */
export function moveNode(
  draft: WorkspaceTree,
  id: string,
  destination: MoveDestination,
  index?: number,
): void {
  const found = locate(draft, id)
  if (!found) return
  if (found.kind === 'collection' && destination.kind !== 'same') return

  const target = containerFor(draft, found, destination)
  if (!target) return

  found.siblings.splice(found.index, 1)

  // Clamp after the removal: within one container the source index shifts
  // everything after it down by one, so an unclamped index can be one past the
  // end — which `splice` treats as "append", quietly turning "move up" into
  // "move to the bottom".
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
  target.splice(at, 0, found.node)

  if (found.kind === 'folder') {
    ;(found.node as FolderNode).parentFolderId =
      destination.kind === 'folder' ? destination.folderId : parentIdAfter(found, destination)
  } else if (found.kind === 'request') {
    ;(found.node as RequestNode).folderId =
      destination.kind === 'folder' ? destination.folderId : parentIdAfter(found, destination)
  }
}

/** The parent id a node keeps when it is not moving into a named folder. */
function parentIdAfter(found: Located, destination: MoveDestination): string | null {
  if (destination.kind === 'root') return null
  return found.kind === 'folder'
    ? (found.node as FolderNode).parentFolderId
    : (found.node as RequestNode).folderId
}

function containerFor(
  draft: WorkspaceTree,
  found: Located,
  destination: MoveDestination,
): AnyNode[] | undefined {
  if (destination.kind === 'same') return found.siblings

  const parent =
    destination.kind === 'root'
      ? found.collection
      : findFolder(draft, destination.folderId)?.folder
  if (!parent) return undefined

  // A folder cannot be moved inside itself or its own descendants — the server
  // answers 409 for that, and an optimistic patch that did it would detach the
  // subtree from the render root and make it invisible until a refetch.
  if (found.kind === 'folder' && parent !== found.collection) {
    if (parent === found.node) return undefined
    if (findFolderIn((found.node as FolderNode).folders, parent.id)) return undefined
  }

  return found.kind === 'folder'
    ? (parent as CollectionNode | FolderNode).folders
    : (parent as CollectionNode | FolderNode).requests
}

export function renameNode(
  draft: WorkspaceTree,
  id: string,
  name: string,
): void {
  const found = locate(draft, id)
  if (found) found.node.name = name
}

export function setRequestMethod(
  draft: WorkspaceTree,
  id: string,
  method: HttpMethod,
): void {
  const found = locate(draft, id)
  if (found?.kind === 'request') (found.node as RequestNode).method = method
}

// --------------------------------------------------------------- queries

/**
 * The ancestor chain of a request, so a deep link opens visible. Lives here
 * with the other walks rather than in `Sidebar`.
 */
export function ancestorsOf(
  tree: WorkspaceTree | undefined,
  requestId: string,
): string[] {
  if (!tree) return []

  const walk = (folders: readonly FolderNode[], trail: string[]): string[] | null => {
    for (const folder of folders) {
      const here = [...trail, folder.id]
      if (folder.requests.some((r) => r.id === requestId)) return here
      const deeper = walk(folder.folders, here)
      if (deeper) return deeper
    }
    return null
  }

  for (const collection of tree.collections) {
    if (collection.requests.some((r) => r.id === requestId)) return [collection.id]
    const inFolders = walk(collection.folders, [collection.id])
    if (inFolders) return inFolders
  }
  return []
}

/** Whether deleting `rootId` would also remove `requestId`. */
export function subtreeContains(
  tree: WorkspaceTree | undefined,
  rootId: string,
  requestId: string,
): boolean {
  if (rootId === requestId) return true
  if (!tree) return false

  const found = locate(tree, rootId)
  if (!found || found.kind === 'request') return false

  const holds = (node: CollectionNode | FolderNode): boolean =>
    node.requests.some((r) => r.id === requestId) || node.folders.some(holds)

  return holds(found.node as CollectionNode | FolderNode)
}
