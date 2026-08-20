import { Select } from '../../components/ui/Select'
import { THEMES, themeById, type ThemePreference } from './themes'
import { useTheme } from './useTheme'

/**
 * The theme picker, on the shared [Select](../../components/ui/Select.tsx),
 * matching `WorkspaceSwitcher`.
 *
 * It is the picker that most wanted a non-native list: each theme's `hint` is a
 * second line under its label here, where a native `<option>` could only carry
 * it as a `title` tooltip nobody discovers.
 */
const toItem = (entry: (typeof THEMES)[number]) => ({
  value: entry.id,
  label: entry.label,
  hint: entry.hint,
})

export function ThemeMenu() {
  const { preference, theme, setPreference } = useTheme()

  const light = THEMES.filter((entry) => entry.appearance === 'light')
  const dark = THEMES.filter((entry) => entry.appearance === 'dark')

  return (
    <Select
      label="Theme"
      value={preference}
      onValueChange={(next) => setPreference(next as ThemePreference)}
      entries={[
        // Naming what "system" currently resolves to. Without it the control is
        // the one place in the app that cannot answer "so which am I on?" — the
        // user sees `System` while looking at a dark page and has no way to
        // tell whether that was the OS or a stuck preference.
        { value: 'system', label: `System · ${themeById(theme).label}` },
        { label: 'Light', items: light.map(toItem) },
        { label: 'Dark', items: dark.map(toItem) },
      ]}
    />
  )
}
