import type { ReactNode } from 'react'
import { ChevronIcon } from './NodeIcon'

/** The row chrome every node shares: chevron, icon, label, kebab. */
export function NodeRow({
  depth,
  isActive,
  onClick,
  chevron,
  icon,
  children,
  menu,
}: {
  depth: number
  isActive?: boolean
  onClick?: () => void
  chevron?: ReactNode
  icon?: ReactNode
  children: ReactNode
  menu?: ReactNode
}) {
  return (
    <div
      className={`group flex items-center gap-1 pr-1 text-sm transition ${
        isActive ? 'bg-accent-soft text-accent-soft-fg' : 'hover:bg-surface-muted'
      }`}
      // Tailwind 4 cannot generate `pl-[…]` from a runtime value, so the
      // indent is an inline style.
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {chevron}
      {/* The icon lives *inside* the label button rather than beside it, so
          clicking it does what clicking the name does. `min-w-0` is what lets
          the label's `truncate` win against the flex item's content width. */}
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
      >
        {icon}
        {children}
      </button>
      {menu}
    </div>
  )
}

/**
 * The expand/collapse arrow. The icon is decorative; the state is not — it is
 * on `aria-expanded`, so the SVG stays `aria-hidden`.
 *
 * ⚠️ The button's width is shared with `RequestNodeView`'s spacer: a request
 * has no children and renders an empty box of the same width so its label
 * lines up with its sibling folders'. Changing `w-5` here means changing it
 * there in the same edit, or every request row shifts out of the gutter.
 */
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
      className="flex w-5 shrink-0 items-center justify-center text-fg-faint hover:text-fg-muted"
    >
      <ChevronIcon expanded={expanded} />
    </button>
  )
}
