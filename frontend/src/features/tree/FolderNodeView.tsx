import type { FolderNode } from '@postman-clone/contracts'
import { InlineRename } from './InlineRename'
import { NodeMenu, type MenuItem } from './NodeMenu'
import { Chevron, NodeRow } from './NodeRow'
import { RequestNodeView } from './RequestNodeView'

/** What every node view needs to render itself and its subtree. */
export interface TreeHandlers {
  isExpanded: (id: string) => boolean
  toggle: (id: string) => void
  renamingId: string | null
  startRename: (id: string) => void
  cancelRename: () => void
  commitRename: (
    kind: 'collection' | 'folder' | 'request',
    id: string,
    name: string,
  ) => void
  openRequest: (id: string) => void
  activeRequestId?: string
  menuFor: (
    kind: 'collection' | 'folder' | 'request',
    node: { id: string; name: string },
    context: { collectionId: string; siblings: readonly { id: string }[] },
  ) => MenuItem[]
}

/**
 * Recursive: child folders first, then requests.
 *
 * Folders and requests never interleave — they are two tables with two
 * independent position sequences, which is exactly what Postman does and what
 * removes the cross-table MAX(), lock and reindex from the backend.
 */
export function FolderNodeView({
  node,
  depth,
  collectionId,
  siblings,
  handlers,
}: {
  node: FolderNode
  depth: number
  collectionId: string
  siblings: readonly { id: string }[]
  handlers: TreeHandlers
}) {
  const expanded = handlers.isExpanded(node.id)

  if (handlers.renamingId === node.id) {
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
            items={handlers.menuFor('folder', node, { collectionId, siblings })}
            label={node.name}
          />
        }
      >
        <span className="text-fg-muted">{node.name}</span>
      </NodeRow>

      {expanded && (
        <>
          {node.folders.map((child) => (
            <FolderNodeView
              key={child.id}
              node={child}
              depth={depth + 1}
              collectionId={collectionId}
              siblings={node.folders}
              handlers={handlers}
            />
          ))}
          {node.requests.map((request) => (
            <RequestNodeView
              key={request.id}
              node={request}
              depth={depth + 1}
              isActive={handlers.activeRequestId === request.id}
              isRenaming={handlers.renamingId === request.id}
              onOpen={() => handlers.openRequest(request.id)}
              onRename={(name) =>
                handlers.commitRename('request', request.id, name)
              }
              onCancelRename={handlers.cancelRename}
              menuItems={handlers.menuFor('request', request, {
                collectionId,
                siblings: node.requests,
              })}
            />
          ))}
          {node.folders.length === 0 && node.requests.length === 0 && (
            <p
              className="py-1 text-xs text-fg-faint"
              style={{ paddingLeft: 8 + (depth + 1) * 14 }}
            >
              Empty
            </p>
          )}
        </>
      )}
    </>
  )
}
