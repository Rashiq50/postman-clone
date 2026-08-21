/**
 * The inline glyphs used by the two auth screens.
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
 * The wordmark's glyph: a send arrow inside a rounded square.
 *
 * Send is the app's primary verb, so the mark is the same idea as the URL bar's
 * primary button rather than a generic abstract shape.
 */
export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        fill="currentColor"
        opacity="0.12"
      />
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        opacity="0.35"
      />
      <path
        d="M9.5 16.2 22.5 10l-4.2 12.6-2.6-5.2-6.2-1.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m15.7 17.4 3.4-3.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
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
