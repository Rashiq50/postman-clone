import { THEMES, themeById, type ThemePreference } from './themes'
import { useTheme } from './useTheme'

/**
 * The theme picker: a plain `<select>`, matching `WorkspaceSwitcher`.
 *
 * No popover, no icon library. A native select is keyboard- and
 * screen-reader-correct for free, renders in the platform's own dark styling
 * because the theme sets `color-scheme`, and costs no dependency — which is
 * the same call `BodyTab` and the sidebar glyphs already made.
 */
export function ThemeMenu() {
  const { preference, theme, setPreference } = useTheme()

  const light = THEMES.filter((entry) => entry.appearance === 'light')
  const dark = THEMES.filter((entry) => entry.appearance === 'dark')

  return (
    <select
      value={preference}
      aria-label="Theme"
      onChange={(event) => setPreference(event.target.value as ThemePreference)}
      className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-fg-muted outline-none focus:border-accent"
    >
      {/*
        Naming what "system" currently resolves to. Without it the control is
        the one place in the app that cannot answer "so which am I on?" — the
        user sees `System` while looking at a dark page and has no way to tell
        whether that was the OS or a stuck preference.
      */}
      <option value="system">System · {themeById(theme).label}</option>

      <optgroup label="Light">
        {light.map((entry) => (
          <option key={entry.id} value={entry.id} title={entry.hint}>
            {entry.label}
          </option>
        ))}
      </optgroup>

      <optgroup label="Dark">
        {dark.map((entry) => (
          <option key={entry.id} value={entry.id} title={entry.hint}>
            {entry.label}
          </option>
        ))}
      </optgroup>
    </select>
  )
}
