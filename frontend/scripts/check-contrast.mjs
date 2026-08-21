/**
 * Contrast audit for the theme tokens in `src/index.css`.
 *
 * A theme is cheap to add — one block of custom properties — which is exactly
 * why it needs a guard. Nothing else in the build has an opinion about whether
 * `--fg-subtle` is still readable on `--surface` after someone retuned the
 * greys, and the failure mode is not a crash but text that a subset of users
 * simply cannot read, on a theme the author may not use themselves.
 *
 * Run with `yarn contrast`. It parses the CSS rather than importing anything,
 * so it stays honest even if the tokens are refactored: what it measures is
 * what ships.
 *
 * The pairs below are the ones the components actually put together. When you
 * introduce a token combination that is not listed here, add it here too —
 * an unlisted pair is unchecked, not passing.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.css')

/** `:root { … }` is the light theme; `:root[data-theme='x'] { … }` is the rest. */
function readThemes(css) {
  const themes = {}
  const blockRe = /:root(?:\[data-theme='([\w-]+)'\])?\s*\{([\s\S]*?)\n\}/g

  let match
  while ((match = blockRe.exec(css))) {
    const name = match[1] ?? 'light'
    const vars = {}
    for (const line of match[2].split('\n')) {
      const declaration = line.match(/^\s*(--[\w-]+):\s*([^;]+);/)
      if (declaration) vars[declaration[1]] = declaration[2].trim()
    }
    if (Object.keys(vars).length > 0) themes[name] = vars
  }
  return themes
}

/** `#rrggbb` or `rgb(r g b / a)` — the two forms the token blocks use. */
function parseColour(value) {
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      1,
    ]
  }

  const rgb = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)/)
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]]

  throw new Error(`check-contrast cannot parse the colour: ${value}`)
}

/**
 * The dark themes' soft fills are translucent, so their real contrast depends
 * on what is behind them. Compositing rather than ignoring alpha is the whole
 * reason this is a script and not a spreadsheet.
 */
const composite = (colour, backdrop) =>
  colour.slice(0, 3).map((channel, i) => channel * colour[3] + backdrop[i] * (1 - colour[3]))

function luminance([r, g, b]) {
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(foreground, background, base) {
  const backdrop = composite(parseColour(background), base)
  const text = composite(parseColour(foreground), backdrop)
  const [lighter, darker] = [luminance(text), luminance(backdrop)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * What is *behind* a token, which is the whole question once a theme makes its
 * surfaces translucent rather than only its badges.
 *
 * The stack the app actually builds is two deep: `--canvas` is the opaque
 * ground, `--surface` sits on the canvas, and every other fill — the soft
 * badges, `--surface-muted`, `--surface-disabled` — sits on a surface. So
 * `--surface` is composited over the canvas, and everything else over the
 * *composited* surface.
 *
 * ⚠️ Compositing `--surface` over itself, as a single fixed base would, is not
 * a small error in the glass theme: a translucent white surface measured
 * against a white base reports a near-white backdrop, which turns every dark
 * foreground into a comfortable pass and every light one into a failure. The
 * audit would be confidently wrong rather than silent, which is worse.
 */
function baseFor(token, vars) {
  const canvas = parseColour(vars['--canvas'])
  if (token === '--canvas' || token === '--surface') return canvas
  return composite(parseColour(vars['--surface']), canvas)
}

/**
 * `[label, foreground, background, minimum]`.
 *
 * 4.5 is WCAG AA for body text. 3.0 is used for the two roles that are not
 * body text: `fg-faint` (placeholders, `Empty` markers, the `⋯` glyph) and
 * disabled controls, which AA exempts — but not to zero, because a disabled
 * button whose label has vanished reads as a rendering bug.
 */
const PAIRS = [
  ['fg on canvas', '--fg', '--canvas', 4.5],
  ['fg on surface', '--fg', '--surface', 4.5],
  ['fg-muted on surface', '--fg-muted', '--surface', 4.5],
  ['fg-muted on canvas', '--fg-muted', '--canvas', 4.5],
  ['fg-muted on surface-muted', '--fg-muted', '--surface-muted', 4.5],
  ['fg-subtle on surface', '--fg-subtle', '--surface', 4.5],
  ['fg-subtle on canvas', '--fg-subtle', '--canvas', 4.5],
  ['fg-faint on surface', '--fg-faint', '--surface', 3.0],
  ['on-accent on accent', '--on-accent', '--accent', 4.5],
  ['on-accent on accent-hover', '--on-accent', '--accent-hover', 4.5],
  ['accent on surface', '--accent', '--surface', 4.5],
  ['accent on canvas', '--accent', '--canvas', 4.5],
  ['accent-soft-fg on accent-soft', '--accent-soft-fg', '--accent-soft', 4.5],
  // The destructive button in `ConfirmDialog`. Like `--on-accent`, it cannot be
  // one colour across themes: white on the dark themes' lighter red fails.
  ['on-danger on danger', '--on-danger', '--danger', 4.5],
  ['on-danger on danger-hover', '--on-danger', '--danger-hover', 4.5],
  ['danger on surface', '--danger', '--surface', 4.5],
  ['danger on canvas', '--danger', '--canvas', 4.5],
  ['danger-soft-fg on danger-soft', '--danger-soft-fg', '--danger-soft', 4.5],
  ['success-soft-fg on success-soft', '--success-soft-fg', '--success-soft', 4.5],
  // ⚠️ A pair not listed here is unchecked, not passing. `info` is the 3xx
  // status pill, added with Send.
  ['info-soft-fg on info-soft', '--info-soft-fg', '--info-soft', 4.5],
  ['warning-soft-fg on warning-soft', '--warning-soft-fg', '--warning-soft', 4.5],
  ['method-get on surface', '--method-get', '--surface', 4.5],
  ['method-post on surface', '--method-post', '--surface', 4.5],
  ['method-put on surface', '--method-put', '--surface', 4.5],
  ['method-patch on surface', '--method-patch', '--surface', 4.5],
  ['method-delete on surface', '--method-delete', '--surface', 4.5],
  ['method-other on surface', '--method-other', '--surface', 4.5],
  ['fg-disabled on surface-disabled', '--fg-disabled', '--surface-disabled', 3.0],
]

const themes = readThemes(readFileSync(CSS_PATH, 'utf8'))
let failures = 0

for (const [name, vars] of Object.entries(themes)) {
  console.log(`\n${name}`)
  for (const [label, foreground, background, minimum] of PAIRS) {
    const missing = [foreground, background].filter((token) => !vars[token])
    if (missing.length > 0) {
      failures++
      console.log(`  MISSING  ${label.padEnd(32)} ${missing.join(', ')}`)
      continue
    }

    const ratio = contrast(
      vars[foreground],
      vars[background],
      baseFor(background, vars),
    )
    const ok = ratio >= minimum
    if (!ok) failures++
    console.log(
      `  ${ok ? 'ok      ' : 'FAIL    '} ${label.padEnd(32)} ${ratio.toFixed(2)}:1 (min ${minimum})`,
    )
  }
}

if (failures > 0) {
  console.error(`\n${failures} pair(s) below target — retune the tokens, not the thresholds.`)
  process.exit(1)
}

console.log(`\nAll ${Object.keys(themes).length * PAIRS.length} pairs pass.`)
