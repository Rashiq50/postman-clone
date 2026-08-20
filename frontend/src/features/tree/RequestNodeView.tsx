import type { RequestNode } from '@postman-clone/contracts'
import { memo } from 'react'
import { InlineRename } from './InlineRename'
import { methodStyles } from './methodStyles'
import { NodeMenu } from './NodeMenu'
import { NodeRow } from './NodeRow'
import type { TreeHandlers } from './treeHandlers'
import { useIsActiveRequest, useIsRenaming } from './treeUi'

/**
 * Takes the same five props as the folder view and reads "am I active?" and
 * "am I being renamed?" from the store itself rather than as booleans from its
 * parent. Passing them down would mean the parent re-renders — and re-renders
 * all of its other children — every time the selection moves.
 */
export const RequestNodeView = memo(function RequestNodeView({
  node,
  depth,
  collectionId,
  index,
  siblingCount,
  handlers,
}: {
  node: RequestNode
  depth: number
  collectionId: string
  index: number
  siblingCount: number
  handlers: TreeHandlers
}) {
  const isActive = useIsActiveRequest(handlers.ui, node.id)
  const renaming = useIsRenaming(handlers.ui, node.id)

  if (renaming) {
    return (
      <InlineRename
        initialValue={node.name}
        onCommit={(name) => handlers.commitRename('request', node.id, name)}
        onCancel={handlers.cancelRename}
        depth={depth}
      />
    )
  }

  return (
    <NodeRow
      depth={depth}
      isActive={isActive}
      onClick={() => handlers.openRequest(node.id)}
      // A request has no children, so it gets the chevron's width as spacing
      // rather than a control — otherwise its label would not line up with its
      // sibling folders'.
      chevron={<span className="w-5 shrink-0" aria-hidden />}
      menu={
        <NodeMenu
          getItems={() =>
            handlers.menuFor('request', node, {
              collectionId,
              index,
              siblingCount,
              parentId: node.folderId,
            })
          }
          label={node.name}
        />
      }
    >
      <span
        className={`shrink-0 font-mono text-[10px] font-semibold ${methodStyles[node.method]}`}
      >
        {node.method}
      </span>
      <span className="truncate">{node.name}</span>
    </NodeRow>
  )
})
