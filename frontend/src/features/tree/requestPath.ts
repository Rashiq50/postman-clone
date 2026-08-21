import type { FolderNode, WorkspaceTree } from '@raven/contracts'

/**
 * The **names** of the containers a request sits in — `[collection, …folders]`
 * — for the breadcrumb above the request editor's title.
 *
 * Deliberately separate from `ancestorsOf` in [treeCache.ts](./treeCache.ts),
 * which answers with *ids* because its callers are cache patches that need to
 * address nodes. A breadcrumb needs the labels, and folding both jobs into one
 * walk would mean returning pairs neither caller wants.
 *
 * ⚠️ Total and silent, like every other tree helper here: an id the tree does
 * not contain answers `[]` and the breadcrumb simply does not render. That is a
 * legitimate state, not an error — the tree may still be loading, or another
 * tab may have moved the request out from under this one, and the focus
 * reconcile is what fixes the second case.
 */
export function requestPath(
  tree: WorkspaceTree | undefined,
  requestId: string,
): string[] {
  if (!tree) return []

  const walk = (
    folders: readonly FolderNode[],
    trail: string[],
  ): string[] | null => {
    for (const folder of folders) {
      const here = [...trail, folder.name]
      if (folder.requests.some((request) => request.id === requestId)) return here
      const deeper = walk(folder.folders, here)
      if (deeper) return deeper
    }
    return null
  }

  for (const collection of tree.collections) {
    if (collection.requests.some((request) => request.id === requestId)) {
      return [collection.name]
    }
    const inFolders = walk(collection.folders, [collection.name])
    if (inFolders) return inFolders
  }
  return []
}
