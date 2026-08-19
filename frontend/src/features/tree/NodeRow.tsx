import type { ReactNode } from 'react'

/** The row chrome every node shares: chevron, label, kebab. */
export function NodeRow({
  depth,
  isActive,
  onClick,
  chevron,
  children,
  menu,
}: {
  depth: number
  isActive?: boolean
  onClick?: () => void
  chevron?: ReactNode
  children: ReactNode
  menu?: ReactNode
}) {
  return (
    <div
      className={`group flex items-center gap-1 pr-1 text-sm transition ${
        isActive ? 'bg-indigo-50 text-indigo-800' : 'hover:bg-slate-100'
      }`}
      // Tailwind 4 cannot generate `pl-[…]` from a runtime value, so the
      // indent is an inline style.
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {chevron}
      <button
        type="button"
        onClick={onClick}
        className="min-w-0 flex-1 truncate py-1 text-left"
      >
        {children}
      </button>
      {menu}
    </div>
  )
}

/** The expand/collapse triangle. The glyph is decorative; the state is not. */
export function Chevron({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean
  onToggle: () => void
  label: string
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
      onClick={onToggle}
      className="w-4 shrink-0 text-xs text-slate-400 hover:text-slate-700"
    >
      <span aria-hidden>{expanded ? '▾' : '▸'}</span>
    </button>
  )
}
