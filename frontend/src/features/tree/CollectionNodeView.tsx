import type { CollectionNode } from '@postman-clone/contracts'
import { memo } from 'react'
import { FolderNodeView } from './FolderNodeView'
import { InlineRename } from './InlineRename'
import { NodeMenu } from './NodeMenu'
import { Chevron, NodeRow } from './NodeRow'
import { RequestNodeView } from './RequestNodeView'
import type { TreeHandlers } from './treeHandlers'
import { useIsExpanded, useIsRenaming } from './treeUi'

/**
 * ⚠️ `memo` here, and on the folder and request views, is what keeps the tree
 * usable at scale: a cache patch or a chevron click re-renders `Sidebar`, and
 * without this every mounted row below it re-renders too. The props are all
 * referentially stable — `node` comes straight out of the RTK Query cache
 * (immer's structural sharing keeps untouched subtrees identical across a patch
 * or a refetch), the sibling slot is two numbers rather than an array, and
 * `handlers` is memoized in `Sidebar` — so an edit in one collection leaves the
 * other 499 alone.
 */
export const CollectionNodeView = memo(function CollectionNodeView({
  node,
  index,
  siblingCount,
  handlers,
}: {
  node: CollectionNode
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
        onCommit={(name) => handlers.commitRename('collection', node.id, name)}
        onCancel={handlers.cancelRename}
        depth={0}
      />
    )
  }

  return (
    <>
      <NodeRow
        depth={0}
        onClick={() => handlers.ui.toggle(node.id)}
        chevron={
          <Chevron
            expanded={expanded}
            onToggle={() => handlers.ui.toggle(node.id)}
            label={node.name}
          />
        }
        menu={
          <NodeMenu
            getItems={() =>
              handlers.menuFor('collection', node, {
                collectionId: node.id,
                index,
                siblingCount,
                parentId: null,
              })
            }
            label={node.name}
          />
        }
      >
        <span className="font-medium text-fg">{node.name}</span>
      </NodeRow>

      {expanded && (
        <>
          {node.folders.map((folder, at) => (
            <FolderNodeView
              key={folder.id}
              node={folder}
              depth={1}
              collectionId={node.id}
              index={at}
              siblingCount={node.folders.length}
              handlers={handlers}
            />
          ))}
          {node.requests.map((request, at) => (
            <RequestNodeView
              key={request.id}
              node={request}
              depth={1}
              collectionId={node.id}
              index={at}
              siblingCount={node.requests.length}
              handlers={handlers}
            />
          ))}
          {node.folders.length === 0 && node.requests.length === 0 && (
            <p className="py-1 pl-[36px] text-xs text-fg-faint">Empty</p>
          )}
        </>
      )}
    </>
  )
})
