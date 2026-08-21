import type { FormEvent, ReactNode } from 'react'

/**
 * The card. `glass` rather than `glass-tint` — this panel has the canvas wash
 * passing behind it and nothing `position: fixed` inside it, which is the pair
 * of conditions the *Theming* rules set for spending a backdrop blur.
 */
export function AuthCard({
  onSubmit,
  children,
}: {
  onSubmit: (event: FormEvent) => void
  children: ReactNode
}) {
  return (
    <form
      onSubmit={onSubmit}
      // The browser's native bubble for `type="email"` speaks in a different
      // voice from the API's field errors, and cannot be styled or read by the
      // same assistive tech. One error channel, not two.
      noValidate
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm glass"
    >
      {children}
    </form>
  )
}

