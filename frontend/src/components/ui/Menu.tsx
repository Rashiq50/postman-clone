import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * A dropdown menu: a trigger, a panel, and the keyboard behaviour a menu owes
 * its user.
 *
 * ⚠️ **Hand-written, and it must stay that way.** `@radix-ui/react-dropdown-menu`
 * would be a *fourth* Radix package, and the rule in *Frontend workbench rules*
 * is explicit that nothing is added on the strength of "we already have Radix" —
 * each package is its own decision. What it would buy here is Escape,
 * outside-press, focus restore and roving arrow keys, which is the ~70 lines
 * below, shared by both menus in the header. (`NodeMenu` stays separate: it is
 * hand-written for a *different* reason — thousands of instances, a `fixed`
 * panel escaping the sidebar's clip — and folding it in here would drag that
 * positioning problem into a component that does not have it.)
 *
 * ⚠️ The panel is **`absolute`, not `fixed`**, the opposite of `NodeMenu`'s.
 * The header is not a scroll container, so there is no clip to escape, and
 * `absolute` moves with the header for free. The header's `glass` does not
 * interfere: a `backdrop-filter` makes an element a containing block for
 * `fixed` descendants, not for absolute ones.
 *
 * ⚠️ **Items are found by role, from the DOM**, rather than passed as a model.
 * That is what lets one call site render `menuitem` buttons and another render
 * `menuitemradio` rows with no shared item type between them — and it means a
 * caller cannot get the arrow-key order out of step with the visual order,
 * because there is only one order.
 */
export function Menu({
  label,
  trigger,
  panelClassName = 'w-60',
  children,
}: {
  /** Names the menu for assistive tech; also the trigger's `aria-label`. */
  label: string
  /** The button's contents. The element itself belongs to `Menu`. */
  trigger: ReactNode
  panelClassName?: string
  /** `close` is handed in so an item can dismiss the menu as it acts. */
  children: (close: (restoreFocus?: boolean) => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /**
   * ⚠️ Focus is restored to the trigger on *every* close, including Escape,
   * not only on selecting an item. Without it a keyboard user who opens the
   * menu and changes their mind is dropped on `<body>` and has to tab in from
   * the top of the page — the same failure `Dialog` handles for modals.
   *
   * The exception is an outside click, which moves focus itself; restoring
   * there would yank it back from whatever the user just clicked.
   */
  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  /** The focusable rows, in visual order. */
  const items = () =>
    Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"],[role="menuitemradio"]',
      ) ?? [],
    )

  // Move focus into the panel once it exists, so the arrow keys have somewhere
  // to start and the menu is operable without a mouse.
  useEffect(() => {
    if (open) items()[0]?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target)) return
      // The trigger's own click toggles; letting this fire too would close and
      // immediately reopen, which reads as a menu refusing to close.
      if (buttonRef.current?.contains(target)) return
      close(false)
    }

    // ⚠️ Named, not an inline arrow: `removeEventListener` compares by
    // identity, so an anonymous handler is added on every open and never
    // removed.
    const onResize = () => close(false)

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('resize', onResize)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }

    const focusable = items()
    const current = focusable.indexOf(document.activeElement as HTMLElement)

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Wrapping, which is what a menu does — arrowing past the end of a short
      // list and stopping dead reads as a stuck key.
      const next =
        (current + step + focusable.length) % Math.max(focusable.length, 1)
      focusable[next]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusable[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      focusable[focusable.length - 1]?.focus()
    } else if (event.key === 'Tab') {
      // Tabbing out closes the menu, but must not steal the focus move — so no
      // `preventDefault` here.
      close(false)
    }
  }

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          // Down-arrow opens, which is what a menu button does.
          if (!open && event.key === 'ArrowDown') setOpen(true)
        }}
        className="flex h-8 items-center gap-1.5 rounded-md px-1.5 text-sm text-fg-muted transition hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {trigger}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          // `glass` is safe on the panel itself: an element's own
          // `backdrop-filter` affects where its descendants are positioned, not
          // where the element is, and real content passes behind this one.
          className={`absolute right-0 z-50 mt-1 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg glass ${panelClassName}`}
        >
          {children(close)}
        </div>
      )}
    </div>
  )
}

/** The shared row styling, so the two menus in the header cannot diverge. */
export const MENU_ITEM =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition focus:outline-none text-fg-muted hover:bg-surface-muted focus-visible:bg-surface-muted'

/** The tick column. Rendered transparent rather than absent, so the labels of
 *  checked and unchecked rows line up. */
export function MenuTick({ checked }: { checked: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={`size-3.5 shrink-0 ${checked ? 'text-accent' : 'text-transparent'}`}
    >
      <path d="m3.25 8.5 3.1 3.1 6.4-7.2" />
    </svg>
  )
}
