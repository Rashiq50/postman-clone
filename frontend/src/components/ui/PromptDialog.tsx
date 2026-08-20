import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogPrimaryAction, DialogSecondaryAction } from './Dialog'

/**
 * The replacement for `window.prompt`, on top of [Dialog](./Dialog.tsx).
 *
 * ⚠️ The reason this exists is not that the native one is ugly. It is that
 * `window.prompt` **blocks the main thread**: while it is open React cannot
 * render, RTK Query cannot settle a request, and the browser paints nothing —
 * so an optimistic patch that has already been dispatched sits invisible until
 * the user answers. Chrome also lets a user silence further dialogs per page,
 * after which `prompt` silently returns `null` and "New folder" quietly stops
 * working with no error anywhere.
 *
 * Being a real component, it can also do what the native one cannot: enforce
 * the same emptiness rule the callers used to apply by hand, and disable its
 * confirm button rather than accepting a blank name and discarding it.
 */
export function PromptDialog({
  title,
  label,
  initialValue,
  confirmLabel = 'Create',
  onSubmit,
  onClose,
}: {
  title: string
  /** Visible field label. Falls back to the title when the two would repeat. */
  label?: string
  initialValue: string
  confirmLabel?: string
  /** Called with the trimmed value; never called with an empty one. */
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  // Select rather than just focus: the field opens pre-filled with "New
  // folder", and the first keystroke should replace it the way the native
  // prompt did — not append to it.
  useEffect(() => inputRef.current?.select(), [])

  const trimmed = value.trim()

  const submit = () => {
    if (!trimmed) return
    onSubmit(trimmed)
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      footer={
        <>
          <DialogSecondaryAction>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction onClick={submit} disabled={!trimmed}>
            {confirmLabel}
          </DialogPrimaryAction>
        </>
      }
    >
      <label className="block space-y-1">
        {label && <span className="text-xs font-medium text-fg-muted">{label}</span>}
        <input
          ref={inputRef}
          value={value}
          aria-label={label ?? title}
          onChange={(event) => setValue(event.target.value)}
          // Enter submits from the field. Without it the only way to commit is
          // a Tab to the button, which is worse than the prompt it replaced.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
      </label>
    </Dialog>
  )
}
