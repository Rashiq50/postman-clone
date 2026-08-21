import type { FolderNode } from '@postman-clone/contracts'
import { memo } from 'react'
import { InlineRename } from './InlineRename'
import { NodeMenu } from './NodeMenu'
import { FolderIcon } from './NodeIcon'
import { Chevron, NodeRow } from './NodeRow'
import { RequestNodeView } from './RequestNodeView'
import type { TreeHandlers } from './treeHandlers'
import { useIsExpanded, useIsRenaming } from './treeUi'

/**
 * Recursive: child folders first, then requests.
 *
 * Folders and requests never interleave — they are two tables with two
 * independent position sequences, which is exactly what Postman does and what
 * removes the cross-table MAX(), lock and reindex from the backend.
 *
 * `memo` for the reason given on `CollectionNodeView`.
 */
export const FolderNodeView = memo(function FolderNodeView({
  node,
  depth,
  collectionId,
  index,
  siblingCount,
  handlers,
}: {
  node: FolderNode
  depth: number
  collectionId: string
  index: number
  siblingCount: number
  handlers: TreeHandlers
}) {
  const expanded = useIsExpanded(handlers.ui, node.id)
  const renaming = useIsRenaming(handlers.ui, node.id)

  if (renaming) {
    return (
      <InlineRename
        initialValue={node.name}
        onCommit={(name) => handlers.commitRename('folder', node.id, name)}
        onCancel={handlers.cancelRename}
        depth={depth}
      />
    )
  }

  return (
    <>
      <NodeRow
        depth={depth}
        onClick={() => handlers.ui.toggle(node.id)}
        chevron={
          <Chevron
            expanded={expanded}
            onToggle={() => handlers.ui.toggle(node.id)}
            label={node.name}
          />
        }
        icon={<FolderIcon open={expanded} />}
        menu={
          <NodeMenu
            getItems={() =>
              handlers.menuFor('folder', node, {
                collectionId,
                index,
                siblingCount,
                parentId: node.parentFolderId,
              })
            }
            label={node.name}
          />
        }
      >
        <span className="truncate text-fg-muted">{node.name}</span>
      </NodeRow>

      {expanded && (
        <>
          {node.folders.map((child, at) => (
            <FolderNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              collectionId={collectionId}
              index={at}
              siblingCount={node.folders.length}
              handlers={handlers}
            />
          ))}
          {node.requests.map((request, at) => (
            <RequestNodeView
              key={request.id}
              node={request}
              depth={depth + 1}
              collectionId={collectionId}
              index={at}
              siblingCount={node.requests.length}
              handlers={handlers}
            />
          ))}
          {node.folders.length === 0 && node.requests.length === 0 && (
            // Same reasoning as `CollectionNodeView`'s empty state: the label
            // becomes the action it was describing the absence of.
            <button
              type="button"
              onClick={() => handlers.newRequestIn(collectionId, node.id)}
              className="block w-full py-1 text-left text-xs text-fg-faint transition hover:text-accent"
              style={{ paddingLeft: 8 + (depth + 1) * 14 }}
            >
              <span aria-hidden>+ </span>Add request
            </button>
          )}
        </>
      )}
    </>
  )
})
