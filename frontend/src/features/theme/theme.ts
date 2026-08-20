import {
  isThemeId,
  SYSTEM_DARK,
  SYSTEM_LIGHT,
  themeById,
  type ThemeAppearance,
  type ThemeId,
  type ThemePreference,
} from './themes'

/**
 * The theme store: a tiny external store rather than a Redux slice.
 *
 * It is deliberately outside Redux. The theme has to be on the DOM *before*
 * React mounts — see the inline script in `index.html` — so the store already
 * has to exist as plain module state that the pre-paint path and React can
 * both read. Putting a second copy in Redux would make two sources of truth
 * for one attribute, which is the same argument that keeps `BroadcastChannel`
 * out of auth.
 *
 * ⚠️ **The `localStorage` ban is about the access token, not about this.**
 * `authSlice` keeps the token in memory only because a persisted credential
 * is a real risk; a colour preference is neither a credential nor something
 * the server has any opinion about, and losing it on every reload would be a
 * bug rather than a safeguard. Do not "consistency-fix" this into memory.
 */

/** ⚠️ Mirrored by the inline script in `index.html`. Change both together. */
export const THEME_STORAGE_KEY = 'pc.theme'
export const APPEARANCE_STORAGE_KEY = 'pc.theme.appearance'
export const THEME_ATTRIBUTE = 'data-theme'
export const APPEARANCE_ATTRIBUTE = 'data-appearance'

const DARK_QUERY = '(prefers-color-scheme: dark)'

export interface ThemeState {
  /** What the user picked, `'system'` included. */
  preference: ThemePreference
  /** What that resolves to right now. Never `'system'`. */
  theme: ThemeId
  appearance: ThemeAppearance
}

/**
 * Storage can throw outright — Safari in private mode, a browser with cookies
 * and site data blocked — and a theme is never worth taking the app down for.
 */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference is lost on reload; everything else still works.
  }
}

/** What `'system'` means at this instant. */
export function systemTheme(): ThemeId {
  return window.matchMedia(DARK_QUERY).matches ? SYSTEM_DARK : SYSTEM_LIGHT
}

export function resolveTheme(preference: ThemePreference): ThemeId {
  return preference === 'system' ? systemTheme() : preference
}

/**
 * An unknown value falls back to `'system'` rather than throwing: the stored
 * id can legitimately go stale if a theme is renamed or removed, and the user
 * should get the OS default rather than a broken page.
 */
export function readPreference(): ThemePreference {
  const stored = readStorage(THEME_STORAGE_KEY)
  return isThemeId(stored) ? stored : 'system'
}

function stateFor(preference: ThemePreference): ThemeState {
  const theme = resolveTheme(preference)
  return { preference, theme, appearance: themeById(theme).appearance }
}

let state: ThemeState = stateFor(readPreference())
const listeners = new Set<() => void>()

/**
 * The appearance is mirrored into storage so the pre-paint script can set
 * `data-appearance` without knowing the registry. Without it that script would
 * need its own copy of which themes are dark — a third place to keep in sync,
 * and the one most likely to be forgotten when a theme is added.
 */
function apply(next: ThemeState) {
  const root = document.documentElement
  root.setAttribute(THEME_ATTRIBUTE, next.theme)
  root.setAttribute(APPEARANCE_ATTRIBUTE, next.appearance)
  writeStorage(THEME_STORAGE_KEY, next.preference)
  writeStorage(APPEARANCE_STORAGE_KEY, next.appearance)
}

function commit(next: ThemeState) {
  const changed =
    next.preference !== state.preference ||
    next.theme !== state.theme ||
    next.appearance !== state.appearance

  apply(next)
  if (!changed) return

  state = next
  for (const listener of listeners) listener()
}

export function setPreference(preference: ThemePreference) {
  commit(stateFor(preference))
}

/**
 * `useSyncExternalStore` compares snapshots by identity, so this must return
 * the *same* object until something actually changes — building one per call
 * would re-render on every commit and, in development, trip React's infinite
 * loop detector.
 */
export function getThemeState(): ThemeState {
  return state
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Called once at module scope in `main.tsx`, not from an effect: an effect runs
 * after the first paint, so the theme would land a frame late and flash.
 *
 * Re-applying here is not redundant with the inline script. The script sets the
 * attributes optimistically from storage; this is the first point at which the
 * stored id has been validated against the registry, so a stale or hand-edited
 * value is corrected before anyone sees it.
 */
export function initTheme() {
  commit(state)

  // While the preference is `'system'`, the OS is the source of truth and can
  // change under us — at sunset, on a schedule, or by hand.
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    if (state.preference !== 'system') return
    commit(stateFor('system'))
  })
}
