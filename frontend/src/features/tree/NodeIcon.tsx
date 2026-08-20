/**
 * The sidebar's inline SVG glyphs: the folder icon and the expand chevron.
 *
 * ⚠️ No icon library, deliberately — the same call the kebab (`⋯`) already
 * makes. A handful of 16-view-box paths do not justify a dependency, a
 * tree-shaking question and a second styling vocabulary.
 *
 * They are drawn in `currentColor` with no colour of their own, so the row's
 * text token themes them: an icon with a baked-in hex would be the one thing on
 * the page that ignores the theme, which is exactly what *Theming* forbids.
 *
 * ⚠️ **Collections have no icon**, and that is a decision rather than an
 * omission — an archive-box glyph lived here once. A collection is the only
 * node at depth 0, so its position already distinguishes it, and a second
 * container glyph next to the folders' only added noise to the left gutter.
 * Requests have none either: their method label is already their marker.
 */

const SVG_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/**
 * The expand/collapse arrow.
 *
 * ⚠️ It is **one** path rotated by CSS, not two shapes swapped on `expanded`.
 * A rotation animates (the glyphs `▸ ▾` it replaced could only pop) and there
 * is a single outline to keep consistent with the folder icon's weight.
 *
 * It is drawn deliberately larger than the text glyph it replaced: at
 * `text-xs` a `▸` renders around 8px of visible ink, which is below the size a
 * pointer target reads as clickable at all.
 */
export function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      {...SVG_PROPS}
      strokeWidth={1.75}
      className={`size-4 shrink-0 transition-transform duration-150 ${
        expanded ? 'rotate-90' : ''
      }`}
    >
      <path d="M5.75 3 10.75 8l-5 5" />
    </svg>
  )
}

/**
 * Two shapes, keyed on expansion. The chevron already carries the state, but a
 * closed folder next to an open chevron reads as a mistake, and the open tilt
 * is what makes a deep tree scannable at a glance.
 */
export function FolderIcon({ open }: { open: boolean }) {
  return (
    <svg {...SVG_PROPS} className="size-3.5 shrink-0 text-fg-faint">
      {open ? (
        <>
          <path d="M2.25 12V4.5a1.25 1.25 0 0 1 1.25-1.25h2.6a1.25 1.25 0 0 1 .9.38l.95.99h4.3a1.25 1.25 0 0 1 1.25 1.25v.88" />
          <path d="M2.6 12.75 4.15 8.4a1 1 0 0 1 .94-.65h8.4a1 1 0 0 1 .94 1.35l-1.4 3.9a1 1 0 0 1-.94.65H3.55a1 1 0 0 1-.95-.9Z" />
        </>
      ) : (
        <path d="M2.25 11.75v-7.25a1.25 1.25 0 0 1 1.25-1.25h2.6a1.25 1.25 0 0 1 .9.38l.95.99h4.3a1.25 1.25 0 0 1 1.25 1.25v5.88a1.25 1.25 0 0 1-1.25 1.25H3.5a1.25 1.25 0 0 1-1.25-1.25Z" />
      )}
    </svg>
  )
}
