import { MENU_ITEM, Menu, MenuTick } from '../../components/ui/Menu'
import { THEMES, themeById, type ThemePreference } from './themes'
import { useTheme } from './useTheme'

/**
 * The header's theme control: an icon button opening a list of themes, each
 * with its one-line description.
 *
 * ⚠️ **The hints are the reason this is not a plain list of labels.** "Glass"
 * and "Midnight" tell a first-time reader nothing; "Midnight, behind frosted
 * panels" does. They live in [themes.ts](themes.ts) and are the same strings
 * `ThemeMenu`'s `Select` shows on the auth pages, so a new theme still files
 * itself with no change here.
 *
 * ⚠️ **A sun/moon glyph would be wrong.** There are five themes across two
 * appearances, not a light/dark toggle, and an icon that implies a binary
 * switch would mislead about what the button does. The half-filled circle is
 * the conventional "appearance" mark and commits to neither side.
 */
function ContrastIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
      className="size-4"
    >
      <circle
        cx="8"
        cy="8"
        r="5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
      />
      {/* The filled half, drawn in `currentColor` like every other glyph in
          the app — a baked-in hex here would be the one mark that ignores the
          theme it is used to change. */}
      <path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" />
    </svg>
  )
}

export function ThemeButton() {
  const { preference, theme, setPreference } = useTheme()

  const row = (
    value: ThemePreference,
    label: string,
    hint: string,
    close: (restoreFocus?: boolean) => void,
  ) => (
    <button
      key={value}
      type="button"
      role="menuitemradio"
      aria-checked={preference === value}
      onClick={() => {
        setPreference(value)
        // ⚠️ Closes on pick, and restores focus to the trigger. A theme change
        // repaints the whole page, so leaving the menu open over a surface that
        // has just changed colour reads as the app redrawing around a stuck
        // panel — and there is nothing left to do in the menu anyway.
        close()
      }}
      className={`${MENU_ITEM} items-start`}
    >
      <MenuTick checked={preference === value} />
      <span className="min-w-0">
        <span className="block truncate text-fg">{label}</span>
        <span className="block text-xs text-fg-subtle">{hint}</span>
      </span>
    </button>
  )

  return (
    <Menu label="Theme" trigger={<ContrastIcon />} panelClassName="w-64">
      {(close) => (
        <>
          {/* Naming what "system" currently resolves to. Without it this is the
              one control that cannot answer "so which am I on?" — the reader
              sees `System` while looking at a dark page with no way to tell
              whether that was the OS or a stuck preference. */}
          {row(
            'system',
            'System',
            `Follows your OS · currently ${themeById(theme).label}`,
            close,
          )}

          {(['light', 'dark'] as const).map((appearance) => (
            <div key={appearance} className="border-t border-line-subtle pt-1">
              <p className="px-3 pb-0.5 text-[11px] font-semibold tracking-wide text-fg-faint uppercase">
                {appearance}
              </p>
              {THEMES.filter((entry) => entry.appearance === appearance).map(
                (entry) => row(entry.id, entry.label, entry.hint, close),
              )}
            </div>
          ))}
        </>
      )}
    </Menu>
  )
}
