import type { CollectionNode } from '@postman-clone/contracts'
import { FolderNodeView, type TreeHandlers } from './FolderNodeView'
import { InlineRename } from './InlineRename'
import { NodeMenu } from './NodeMenu'
import { Chevron, NodeRow } from './NodeRow'
import { RequestNodeView } from './RequestNodeView'

export function CollectionNodeView({
  node,
  siblings,
  handlers,
}: {
  node: CollectionNode
  siblings: readonly { id: string }[]
  handlers: TreeHandlers
}) {
  const expanded = handlers.isExpanded(node.id)

  if (handlers.renamingId === node.id) {
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
        onClick={() => handlers.toggle(node.id)}
        chevron={
          <Chevron
            expanded={expanded}
            onToggle={() => handlers.toggle(node.id)}
            label={node.name}
          />
        }
        menu={
          <NodeMenu
            items={handlers.menuFor('collection', node, {
              collectionId: node.id,
              siblings,
            })}
            label={node.name}
          />
        }
      >
        <span className="font-medium text-slate-800">{node.name}</span>
      </NodeRow>

      {expanded && (
        <>
          {node.folders.map((folder) => (
            <FolderNodeView
              key={folder.id}
              node={folder}
              depth={1}
              collectionId={node.id}
              siblings={node.folders}
              handlers={handlers}
            />
          ))}
          {node.requests.map((request) => (
            <RequestNodeView
              key={request.id}
              node={request}
              depth={1}
              isActive={handlers.activeRequestId === request.id}
              isRenaming={handlers.renamingId === request.id}
              onOpen={() => handlers.openRequest(request.id)}
              onRename={(name) =>
                handlers.commitRename('request', request.id, name)
              }
              onCancelRename={handlers.cancelRename}
              menuItems={handlers.menuFor('request', request, {
                collectionId: node.id,
                siblings: node.requests,
              })}
            />
          ))}
          {node.folders.length === 0 && node.requests.length === 0 && (
            <p className="py-1 pl-[36px] text-xs text-slate-400">Empty</p>
          )}
        </>
      )}
    </>
  )
}
