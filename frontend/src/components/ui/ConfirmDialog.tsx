import { Dialog, DialogSecondaryAction } from './Dialog'

/**
 * The replacement for `window.confirm`, on top of [Dialog](./Dialog.tsx).
 *
 * Same argument as [PromptDialog](./PromptDialog.tsx) — a native `confirm`
 * blocks rendering while it is open and can be permanently suppressed by the
 * user, after which it returns `false` for ever and a Delete silently does
 * nothing. It also has no way to say *which* choice is destructive: both
 * buttons look the same, and the safe one is not reliably the default.
 *
 * ⚠️ **`onConfirm` runs before the dialog unmounts.** Callers depend on that:
 * `Sidebar` reads whether the deletion orphans the open request *first*,
 * because the mutation's optimistic patch removes the subtree from the cache
 * and asking afterwards always answers "no".
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onClose,
}: {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Paints the confirming action as destructive. Delete uses it. */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={message}
      // The message is the `Dialog`'s description, which is what
      // `aria-describedby` points at — so there is no body, and duplicating the
      // text into one would make a screen reader read it twice.
      footer={
        <>
          <DialogSecondaryAction>{cancelLabel}</DialogSecondaryAction>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className={
              danger
                ? 'rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-on-danger hover:bg-danger-hover'
                : 'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover'
            }
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  )
}
