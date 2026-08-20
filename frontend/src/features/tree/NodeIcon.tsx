/**
 * The sidebar's two node icons, as inline SVG.
 *
 * ⚠️ No icon library, deliberately — the same call the chevrons (`▸ ▾`) and the
 * kebab (`⋯`) already make. Two 16-view-box paths do not justify a dependency,
 * a tree-shaking question and a second styling vocabulary.
 *
 * They are drawn in `currentColor` with no colour of their own, so the row's
 * text token themes them: an icon with a baked-in hex would be the one thing on
 * the page that ignores the theme, which is exactly what *Theming* forbids.
 *
 * Requests get no icon here — their method label is already their marker, and a
 * second glyph in front of `GET` would only compete with it.
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
 * A collection is a container of containers, so it is drawn as an archive box
 * rather than a folder — a folder glyph for both levels would make the two
 * kinds indistinguishable at a glance, which is the only job the icon has.
 */
export function CollectionIcon() {
  return (
    <svg {...SVG_PROPS} className="size-3.5 shrink-0 text-fg-subtle">
      <rect x="2" y="2.75" width="12" height="10.5" rx="1.75" />
      <path d="M2 6.25h12M6.25 9.25h3.5" />
    </svg>
  )
}

/**
 * Two shapes, keyed on expansion. The chevron already carries the state, but a
 * closed folder next to a `▾` reads as a mistake, and the open tilt is what
 * makes a deep tree scannable at a glance.
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
