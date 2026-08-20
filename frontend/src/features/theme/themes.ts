/**
 * The theme registry.
 *
 * Adding a theme is two edits and no more: a `:root[data-theme='<id>']` block
 * of tokens in `index.css`, and an entry here so the picker can offer it. No
 * component changes, ever — if a new theme needs one, the missing piece is a
 * token, not a special case.
 *
 * `appearance` is the only thing this file knows that the CSS does not repeat
 * for its own sake: it drives the `data-appearance` attribute, which is what
 * the `dark:` variant keys on, and it groups the picker.
 */

export type ThemeAppearance = 'light' | 'dark'

export interface ThemeDefinition {
  id: string
  label: string
  appearance: ThemeAppearance
  /** One line, shown as the option's title in the picker. */
  hint: string
}

/**
 * A const array rather than a TS `enum` — the frontend compiles with
 * `erasableSyntaxOnly`, so an enum would not build.
 */
export const THEMES = [
  {
    id: 'light',
    label: 'Light',
    appearance: 'light',
    hint: 'The default: cool greys on white.',
  },
  {
    id: 'dark',
    label: 'Dark',
    appearance: 'dark',
    hint: 'Deep navy greys, tuned for long sessions.',
  },
  {
    id: 'midnight',
    label: 'Midnight',
    appearance: 'dark',
    hint: 'True black with a cyan accent, for OLED displays.',
  },
  {
    id: 'glass',
    label: 'Glass',
    appearance: 'dark',
    hint: 'Midnight, behind frosted panels.',
  },
  {
    id: 'paper',
    label: 'Paper',
    appearance: 'light',
    hint: 'Warm off-white with an amber accent.',
  },
] as const satisfies readonly ThemeDefinition[]

export type ThemeId = (typeof THEMES)[number]['id']

/**
 * What the user chose, which is not the same as what is on screen: `'system'`
 * defers to the OS and re-resolves whenever the OS changes.
 */
export type ThemePreference = ThemeId | 'system'

/** The theme `'system'` resolves to on each side of `prefers-color-scheme`. */
export const SYSTEM_LIGHT: ThemeId = 'light'
export const SYSTEM_DARK: ThemeId = 'dark'

export function isThemeId(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value)
}

export function themeById(id: ThemeId): ThemeDefinition {
  // Non-null: `id` is only ever a `ThemeId`, which comes from this array.
  return THEMES.find((theme) => theme.id === id)!
}
