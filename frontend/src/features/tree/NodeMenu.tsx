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
 */
export function NodeMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)

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
        className="rounded px-1.5 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-slate-200 hover:text-slate-700 focus:opacity-100"
      >
        <span aria-hidden>⋯</span>
      </button>

      {anchor && (
        <div
          ref={panelRef}
          role="menu"
          style={{ position: 'fixed', top: anchor.top, left: anchor.left }}
          onMouseDown={(e) => e.stopPropagation()}
          className="z-50 w-44 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setAnchor(null)
                item.onSelect()
              }}
              className={`block w-full px-3 py-1.5 text-left text-sm transition disabled:opacity-40 ${
                item.danger
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-slate-700 hover:bg-slate-100'
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
