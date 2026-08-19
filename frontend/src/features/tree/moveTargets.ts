import type { CollectionNode, FolderNode } from '@postman-clone/contracts'

export interface MoveTarget {
  id: string | null
  label: string
  collectionId: string
}

/**
 * Flattens a workspace into the list of places something can be moved *into*:
 * each collection root, then every folder, indented by depth.
 *
 * `excludeSubtreeOf` drops a folder and everything under it, because moving a
 * folder into its own descendant is a 409 from the server — offering it and
 * then rejecting it is a worse experience than never offering it. The server
 * check stays regardless; this is the courtesy, not the guard.
 */
export function moveTargets(
  collections: readonly CollectionNode[],
  excludeSubtreeOf?: string,
): MoveTarget[] {
  const targets: MoveTarget[] = []

  const walk = (folders: readonly FolderNode[], collectionId: string, depth: number) => {
    for (const folder of folders) {
      if (folder.id === excludeSubtreeOf) continue
      targets.push({
        id: folder.id,
        label: `${'  '.repeat(depth)}${folder.name}`,
        collectionId,
      })
      walk(folder.folders, collectionId, depth + 1)
    }
  }

  for (const collection of collections) {
    targets.push({
      id: null,
      label: `${collection.name} (root)`,
      collectionId: collection.id,
    })
    walk(collection.folders, collection.id, 1)
  }

  return targets
}
