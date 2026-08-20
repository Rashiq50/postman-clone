import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * The `⋯` kebab menu on a tree row.
 *
 * ⚠️ The panel is positioned **`fixed`, from `getBoundingClientRect()`**, not
 * `absolute`. The sidebar is an `overflow-y-auto` scroll container, so an
 * absolutely-positioned panel on the bottom row is clipped by it and simply
 * does not appear — the single most likely piece of visual breakage in this
 * feature, and one that looks like the click handler is broken rather than the
 * CSS. `fixed` escapes the clip, at the cost of having to close on scroll.
 *
 * Escaping the clip is only half of it, though: a panel opened from the last
 * row then runs off the *viewport* instead, which hides the bottom items just
 * as effectively. So the panel is measured once mounted and flipped above its
 * button when there is no room below — see the layout effect.
 *
 * ⚠️ The items arrive as a **thunk**, not as an array. Building them is what
 * every mounted row used to do on every render — a `MenuItem[]` with its
 * closures, thousands of times over, for a menu at most one row has open — and
 * it also dragged the whole tree into the row's memoization equation. The thunk
 * is called once, when the ⋯ button opens the panel.
 */
export function NodeMenu({
  getItems,
  label,
}: {
  getItems: () => MenuItem[]
  label: string
}) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)
  const [items, setItems] = useState<MenuItem[]>([])

  // Measured after mount rather than estimated from `items.length`: the count
  // is not the only thing setting the height, and a guess wrong by one row puts
  // Delete back off-screen — which is the bug this is here to prevent.
  useLayoutEffect(() => {
    if (!anchor) return
    const panel = panelRef.current
    const button = buttonRef.current
    if (!panel || !button) return

    const rect = button.getBoundingClientRect()
    const { offsetHeight: height, offsetWidth: width } = panel

    let top = anchor.top
    let left = anchor.left

    // Flip above the row when the panel would overflow the bottom — but only
    // if there is genuinely more room up there.
    if (top + height > window.innerHeight - 8 && rect.top > height + 8) {
      top = rect.top - height - 4
    }
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))

    if (top !== anchor.top || left !== anchor.left) setAnchor({ top, left })
  }, [anchor])

  useEffect(() => {
    if (!anchor) return

    const close = () => setAnchor(null)
    // Capture phase, so a click inside the scroll container still closes it.
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    // `true` catches scrolling of the sidebar itself, not just the window —
    // without it the panel would hang in place while the row scrolls away.
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [anchor])

  const open = () => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setItems(getItems())
    setAnchor({ top: rect.bottom + 4, left: rect.right - 176 })
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`More actions for ${label}`}
        aria-expanded={anchor !== null}
        onClick={(e) => {
          e.stopPropagation()
          if (anchor) setAnchor(null)
          else open()
        }}
        className="rounded px-1.5 text-fg-faint opacity-0 transition group-hover:opacity-100 hover:bg-surface-muted hover:text-fg-muted focus:opacity-100"
      >
        <span aria-hidden>⋯</span>
      </button>

      {anchor && (
        <div
          ref={panelRef}
          role="menu"
          style={{ position: 'fixed', top: anchor.top, left: anchor.left }}
          onMouseDown={(e) => e.stopPropagation()}
          className="z-50 w-44 overflow-hidden rounded-md border border-line bg-surface py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setAnchor(null)
                // ⚠️ Focus goes back to the ⋯ *before* the action runs, and
                // synchronously. The clicked menu item is about to unmount, so
                // without this the browser drops focus to `<body>` — and an
                // action that opens a dialog (Move to…) would then have nothing
                // to restore focus to when it closes, stranding a keyboard user
                // at the top of the page.
                buttonRef.current?.focus()
                item.onSelect()
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition disabled:opacity-40 ${
                item.danger
                  ? 'text-danger hover:bg-danger-soft'
                  : 'text-fg-muted hover:bg-surface-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
