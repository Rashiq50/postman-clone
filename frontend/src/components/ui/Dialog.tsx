import * as RadixDialog from '@radix-ui/react-dialog'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The app's one modal shell, over Radix's `Dialog` primitive.
 *
 * ⚠️ **Radix is a behaviour dependency, not a design system, and that
 * distinction is the whole reason it is allowed here.** It ships no colours: a
 * focus trap, Escape and outside-press handling, `aria-modal` wiring, scroll
 * lock, focus restore to the trigger, and the portal that escapes an
 * `overflow` ancestor. Every visible pixel below is a semantic token from
 * `index.css`, so `yarn contrast` still audits this surface and another theme
 * is still one CSS block. A styled kit (MUI, Ant) would have brought a second
 * theming engine and put its components outside that audit — see the note in
 * CLAUDE.md.
 *
 * ⚠️ Keep the styling **here**, not at the call sites. One wrapper is what
 * stops "Radix" from meaning "each dialog picks its own padding, radius and
 * overlay", and it is the seam that makes swapping the primitive out later a
 * one-file change.
 *
 * A `title` is mandatory rather than optional — Radix warns without one because
 * a modal with no accessible name is unusable to a screen reader, and an
 * optional prop is an invitation to omit it.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'sm',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  /** Optional: a confirm dialog is its title and description and nothing else. */
  children?: ReactNode
  /** Actions, right-aligned. Left out entirely when a dialog has none. */
  footer?: ReactNode
  /**
   * Width. `sm` is the prompt/confirm shape; `lg` is for a dialog with real
   * content laid out inside it (the environment manager's list + variable
   * grid), and it is viewport-relative — a fixed `max-w-*` that looks roomy
   * on a laptop is a postage stamp on a 1440p monitor, so `lg` takes 92vw up
   * to a 72rem line-length cap. ⚠️ It is a fixed set rather than a `className` escape hatch on
   * purpose — a free-form class at the call site is how "one modal shell"
   * becomes "every dialog picks its own padding".
   */
  size?: 'sm' | 'lg'
}) {
  /**
   * ⚠️ Focus restore is done here, not left to Radix, because call sites mount
   * this component conditionally (`{state && <MoveToDialog/>}`). Radix restores
   * focus from `onCloseAutoFocus`, which never runs when the whole tree is
   * unmounted in the same tick that closes it — focus lands on `<body>` and a
   * keyboard user is dropped at the top of the page. Verified in the browser:
   * it is not visible in any test that does not check `document.activeElement`.
   *
   * The `setTimeout` is what makes it deterministic — refocusing during the
   * cleanup races Radix's own teardown, which fires after.
   */
  const restoreTo = useRef<HTMLElement | null>(null)
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null
    return () => {
      const target = restoreTo.current
      if (!target) return
      setTimeout(() => target.isConnected && target.focus(), 0)
    }
  }, [])

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        {/* The scrim is the one blur in the app with the whole app behind
            it, which is why it takes `glass-scrim` (blur, no sheen) while the
            panel above takes the sheen as well. Both are inert unless the
            theme defines the effect tokens. */}
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay glass-scrim" />
        <RadixDialog.Content
          // `top-1/2 -translate-y-1/2` rather than a flex-centred overlay: the
          // content is its own portal child, so it cannot be centred by the
          // overlay without nesting it — and nesting puts the outside-press
          // target inside the dialog.
          // The panel is a flex column with a capped height so a tall body
          // scrolls inside the dialog rather than off the viewport, which a
          // `fixed`, translate-centred element does silently: the overflow goes
          // above the top edge, where there is nothing to scroll it back into
          // view. ⚠️ `min-h-0` on the scrolling child is what makes that real —
          // a flex child defaults to `min-height: auto` and refuses to shrink.
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-4rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-surface p-4 shadow-xl outline-none glass ${
            size === 'lg'
              ? 'w-[min(92vw,72rem)]'
              : 'w-[calc(100%-2rem)] max-w-sm'
          }`}
        >
          <RadixDialog.Title className="text-sm font-medium text-fg">
            {title}
          </RadixDialog.Title>

          {description && (
            <RadixDialog.Description className="mt-1 text-xs text-fg-subtle">
              {description}
            </RadixDialog.Description>
          )}

          {children && (
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">{children}</div>
          )}

          {footer && (
            <div className="mt-4 flex shrink-0 justify-end gap-2">{footer}</div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Cancel-shaped button. Here so a second dialog cannot invent its own. */
export function DialogSecondaryAction({
  children,
  onClick,
}: {
  children: ReactNode
  onClick?: () => void
}) {
  const button = (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-muted"
    >
      {children}
    </button>
  )
  // Wrapped in `Close` when it has no handler of its own, so "Cancel" needs no
  // wiring at the call site and still restores focus the way Escape does.
  return onClick ? button : <RadixDialog.Close asChild>{button}</RadixDialog.Close>
}

/** The confirming action. */
export function DialogPrimaryAction({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
    >
      {children}
    </button>
  )
}
