/**
 * The inline glyphs used by the two auth screens, plus the brand mark — which
 * `AppHeader` imports from here too, since the app has exactly one logo and a
 * second copy is a second thing to redraw.
 *
 * ⚠️ Hand-written SVG in `currentColor`, no icon library — the same call
 * [NodeIcon](../tree/NodeIcon.tsx) already makes, and for the same reasons: a
 * handful of paths do not justify a dependency, and a baked-in hex would be the
 * one thing on these pages that ignores the theme.
 */

const SVG_PROPS = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

/**
 * The brand glyph: Raven, a perched corvid drawn as a single neon outline.
 *
 * ⚠️ **It is drawn in `currentColor` only** — the standalone assets in
 * `public/` (`raven-mark.svg`, `raven-lockup.svg`, `raven-favicon.svg`) carry
 * the fixed violet-to-cyan neon gradient, but those sit on a background this
 * app does not control. In here the mark inherits `text-accent` and re-themes
 * with everything else; a baked-in hex would be the one thing on the page that
 * ignores the theme. The glow is `.neon-mark` in `index.css`, which spends a
 * `drop-shadow` in `currentColor` and only under `data-appearance='dark'`,
 * where a glow has something to sit on.
 */
export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={`neon-mark ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
      focusable="false"
    >
      {/* Body: beak, crown, back, wedge tail, belly, breast, throat. */}
      <path d="M60.5 19.3C55 15.5 51 13 47 12.5C42 8 34 9 31 15C28 21 27 28 24.5 33.5C19 39 11 47 3 56.5L7.5 59C13.5 52 19.5 45.5 26 41C30 39.5 34 40 38 40C44 38 47 33 46 27C45.5 23.5 47 21.5 49 20.5C52.5 20.2 56.5 20 60.5 19.3Z" />
      {/* Folded wing. */}
      <path d="M32.5 17C28 23 24 31 19.5 41C27 38 33 32 36.5 25C36.5 21 35 18.5 32.5 17Z" />
      {/* Legs. */}
      <path d="M37.5 40.5L36 47.5M41.5 39.5L42.5 47" />
      <circle cx="44.5" cy="16.5" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Password reveal, shown while the value is masked. */
export function EyeIcon() {
  return (
    <svg {...SVG_PROPS} viewBox="0 0 16 16" className="size-4">
      <path d="M1.5 8s2.4-4.25 6.5-4.25S14.5 8 14.5 8s-2.4 4.25-6.5 4.25S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.9" />
    </svg>
  )
}

/** Password hide, shown while the value is visible. */
export function EyeOffIcon() {
  return (
    <svg {...SVG_PROPS} viewBox="0 0 16 16" className="size-4">
      <path d="M6.3 3.95A6.6 6.6 0 0 1 8 3.75c4.1 0 6.5 4.25 6.5 4.25a12.4 12.4 0 0 1-2.15 2.7" />
      <path d="M4.05 5.2A12.3 12.3 0 0 0 1.5 8s2.4 4.25 6.5 4.25c.98 0 1.85-.24 2.6-.6" />
      <path d="m6.7 6.75a1.9 1.9 0 0 0 2.62 2.62" />
      <path d="m2.75 2.75 10.5 10.5" />
    </svg>
  )
}

/**
 * The submit button's spinner. A disabled button whose only change is its label
 * reads as unresponsive on a slow connection, which is exactly when it matters.
 */
export function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 animate-spin"
      aria-hidden
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.3"
      />
      <path
        d="M8 1.75A6.25 6.25 0 0 1 14.25 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
