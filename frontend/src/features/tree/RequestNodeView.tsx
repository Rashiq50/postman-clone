import type { RequestNode } from '@postman-clone/contracts'
import { InlineRename } from './InlineRename'
import { methodStyles } from './methodStyles'
import { NodeMenu, type MenuItem } from './NodeMenu'
import { NodeRow } from './NodeRow'

export function RequestNodeView({
  node,
  depth,
  isActive,
  isRenaming,
  onOpen,
  onRename,
  onCancelRename,
  menuItems,
}: {
  node: RequestNode
  depth: number
  isActive: boolean
  isRenaming: boolean
  onOpen: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
  menuItems: MenuItem[]
}) {
  if (isRenaming) {
    return (
      <InlineRename
        initialValue={node.name}
        onCommit={onRename}
        onCancel={onCancelRename}
        depth={depth}
      />
    )
  }

  return (
    <NodeRow
      depth={depth}
      isActive={isActive}
      onClick={onOpen}
      // A request has no children, so it gets the chevron's width as spacing
      // rather than a control — otherwise its label would not line up with its
      // sibling folders'.
      chevron={<span className="w-4 shrink-0" aria-hidden />}
      menu={<NodeMenu items={menuItems} label={node.name} />}
    >
      <span
        className={`mr-2 font-mono text-[10px] font-semibold ${methodStyles[node.method]}`}
      >
        {node.method}
      </span>
      {node.name}
    </NodeRow>
  )
}
