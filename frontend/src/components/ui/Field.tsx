import { useState, type ReactNode, type Ref } from 'react'
import { EyeIcon, EyeOffIcon, Spinner } from '../../features/auth/AuthArt'

/**
 * The form primitives shared by `/login`, `/register` and `/profile`.
 *
 * ⚠️ These lived in `features/auth` until `/profile` became the third screen
 * to render a labelled column of validated text inputs — which was the stated
 * condition for moving them. They are not generic form infrastructure and
 * should not grow into it: a prop added here to serve one call site is the
 * signal that that call site wanted its own component.
 *
 * ⚠️ The password field owns its own reveal state. Hoisting it to the page
 * (as both pages used to) meant `RegisterPage` carried two nearly identical
 * `useState` pairs whose toggles were copy-pasted, which is precisely the
 * asymmetry that lets one of them drift.
 */

const CONTROL =
  'h-10 w-full rounded-lg border bg-surface text-sm text-fg transition outline-none placeholder:text-fg-faint'

const TONE = {
  ok: 'border-line-strong hover:border-fg-faint focus:border-accent focus:ring-2 focus:ring-focus',
  bad: 'border-danger focus:border-danger focus:ring-2 focus:ring-focus-danger',
}

interface FieldProps {
  id: string
  label: string
  /** `password` renders the reveal toggle and the extra right padding. */
  type: 'text' | 'email' | 'password'
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  autoComplete: string
  maxLength?: number
  /** The problem to show, if any. Presence alone drives `aria-invalid`. */
  error?: string
  /** Extra content appended inside the error line — e.g. a "Sign in instead" link. */
  errorSuffix?: ReactNode
  /** Shown in the error's place while the field is valid. */
  hint?: string
  /** `RegisterPage` focuses the first invalid field on submit. */
  inputRef?: Ref<HTMLInputElement>
  /** The reveal button's accessible name, which differs per password field. */
  revealLabel?: { show: string; hide: string }
}

export function Field({
  id,
  label,
  type,
  value,
  onChange,
  onBlur,
  autoComplete,
  maxLength,
  error,
  errorSuffix,
  hint,
  inputRef,
  revealLabel = { show: 'Show password', hide: 'Hide password' },
}: FieldProps) {
  const [revealed, setRevealed] = useState(false)
  const isPassword = type === 'password'
  const invalid = Boolean(error)
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 block text-xs font-medium text-fg-muted"
      >
        {label}
      </label>

      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type={isPassword && revealed ? 'text' : type}
          autoComplete={autoComplete}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={`${CONTROL} ${invalid ? TONE.bad : TONE.ok} ${
            isPassword ? 'pl-3 pr-11' : 'px-3'
          }`}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-controls={id}
            aria-pressed={revealed}
            aria-label={revealed ? revealLabel.hide : revealLabel.show}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-fg-subtle transition hover:text-fg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">
          {error}
          {errorSuffix}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1.5 text-xs text-fg-subtle">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function SubmitButton({
  busy,
  disabled,
  busyLabel,
  inline = false,
  children,
}: {
  busy: boolean
  disabled?: boolean
  busyLabel: string
  /**
   * Auto-width instead of filling its row. The auth cards want the full-width
   * bar (one action, one column); `/profile`'s cards each sit beside a saved
   * message, where a full-width button would push it onto its own line.
   */
  inline?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className={`flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent shadow-sm transition hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:bg-surface-disabled disabled:text-fg-disabled disabled:shadow-none ${
        inline ? 'shrink-0' : 'mt-1 w-full'
      }`}
    >
      {busy && <Spinner />}
      {busy ? busyLabel : children}
    </button>
  )
}

/**
 * The request's own failure — a 401, a 500, a dead connection — as opposed to a
 * field problem.
 *
 * ⚠️ `role="alert"`: it renders at the foot of the card, which a screen-reader
 * user has no reason to move back to. Without it a rejected submit is silent.
 * It is a filled callout rather than a line of red text because it is the one
 * thing on the screen the user must not miss.
 */
export function FormError({
  message,
  code,
}: {
  message: string
  code?: { code: string; requestId: string }
}) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
    >
      {message}
      {code && (
        <span className="mt-0.5 block font-mono text-xs opacity-80">
          {code.code} · {code.requestId.slice(0, 8)}
        </span>
      )}
    </p>
  )
}
