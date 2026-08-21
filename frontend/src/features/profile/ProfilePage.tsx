import { EMAIL_MAX_LENGTH, NAME_MAX_LENGTH, PASSWORD_MAX_LENGTH, passwordProblem } from '@raven/contracts'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Field, FormError, SubmitButton } from '../../components/ui/Field'
import { useAppSelector } from '../../app/hooks'
import {
  errorMessage,
  fieldErrors,
  toApiError,
  type QueryError,
} from '../../lib/api-error'
import {
  useChangePasswordMutation,
  useUpdateProfileMutation,
} from '../auth/authApi'
import { selectCurrentUser } from '../auth/authSlice'

/**
 * `/profile` — the account details.
 *
 * ⚠️ **Three separate forms, not one.** They submit to two different endpoints
 * with two different consequences (a password change revokes the account's
 * other sessions; a rename does not), and only the email form re-authenticates.
 * A single Save across all of it would either demand a password to rename
 * yourself or silently skip the check that matters — and its success message
 * could not say which of the three things happened.
 *
 * ⚠️ There is deliberately **no email verification** and none is implied
 * anywhere on this screen: the new address takes effect on save. It is a
 * documented gap, not an oversight, and the honest thing is to not draw a
 * "verify" affordance that does nothing.
 */

function Card({
  title,
  description,
  onSubmit,
  children,
}: {
  title: string
  description: string
  onSubmit: (event: FormEvent) => void
  children: ReactNode
}) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-xl border border-line bg-surface p-5 shadow-sm glass"
    >
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </form>
  )
}

/**
 * The "it worked" line.
 *
 * ⚠️ `role="status"`, and it is not optional chrome: with no navigation and no
 * visible change after a save, a form that simply goes quiet is
 * indistinguishable from one that failed silently. It clears on the next edit
 * so it can never describe a value the user has since changed.
 */
function Saved({ message }: { message: string }) {
  return (
    <p
      role="status"
      className="rounded-lg border border-line bg-success-soft px-3 py-2 text-sm text-success-soft-fg"
    >
      {message}
    </p>
  )
}

export function ProfilePage() {
  const user = useAppSelector(selectCurrentUser)
  const [updateProfile] = useUpdateProfileMutation()
  const [changePassword] = useChangePasswordMutation()

  return (
    <div className="flex flex-col gap-4">
      <NameCard
        key={`name-${user?.id ?? ''}`}
        current={user?.name ?? ''}
        update={updateProfile}
      />
      <EmailCard
        key={`email-${user?.id ?? ''}`}
        current={user?.email ?? ''}
        update={updateProfile}
      />
      <PasswordCard change={changePassword} />
    </div>
  )
}

type UpdateProfile = ReturnType<typeof useUpdateProfileMutation>[0]
type ChangePassword = ReturnType<typeof useChangePasswordMutation>[0]

function NameCard({
  current,
  update,
}: {
  current: string
  update: UpdateProfile
}) {
  const [name, setName] = useState(current)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // `.unwrap()` rejects with the raw query error, which the helpers read.
  const [error, setError] = useState<QueryError>(undefined)

  /**
   * ⚠️ Keyed on the value, not on the object: `selectCurrentUser` hands back a
   * new reference whenever anything about the user is refetched, and reseeding
   * on that would wipe what the user is typing — the same trap
   * `useRequestDraft` records for `request?.id`.
   */
  useEffect(() => setName(current), [current])

  const problem = name.trim() === '' ? 'Name is required' : undefined
  const dirty = name.trim() !== current

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (problem || !dirty) return
    setBusy(true)
    setError(undefined)
    try {
      await update({ name: name.trim() }).unwrap()
      setSaved(true)
    } catch (err) {
      setError(err as QueryError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Name"
      description="How you are shown in this app."
      onSubmit={submit}
    >
      <Field
        id="profile-name"
        label="Name"
        type="text"
        autoComplete="name"
        maxLength={NAME_MAX_LENGTH}
        value={name}
        onChange={(value) => {
          setName(value)
          setSaved(false)
          setError(undefined)
        }}
        error={fieldErrors(error).name ?? (dirty ? problem : undefined)}
      />
      <div className="flex items-center gap-3">
        <SubmitButton busy={busy} disabled={!dirty} busyLabel="Saving…" inline>
          Save
        </SubmitButton>
        {saved && !dirty && <Saved message="Name updated." />}
      </div>
      {Boolean(error) && (
        <FormError
          message={errorMessage(error, 'Could not save your name.')}
          code={toApiError(error) ?? undefined}
        />
      )}
    </Card>
  )
}

function EmailCard({
  current,
  update,
}: {
  current: string
  update: UpdateProfile
}) {
  const [email, setEmail] = useState(current)
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // `.unwrap()` rejects with the raw query error, which the helpers read.
  const [error, setError] = useState<QueryError>(undefined)

  useEffect(() => setEmail(current), [current])

  const dirty = email.trim().toLowerCase() !== current
  const apiError = toApiError(error)
  const emailTaken = apiError?.code === 'EMAIL_TAKEN'
  // 401 here is not "your session expired" — the guard let the request
  // through — it is the current password being wrong, and it belongs on that
  // field rather than in the summary at the foot of the card.
  const badPassword = apiError?.code === 'UNAUTHENTICATED'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!dirty) return
    setBusy(true)
    setError(undefined)
    try {
      await update({ email: email.trim(), currentPassword: password }).unwrap()
      setPassword('')
      setSaved(true)
    } catch (err) {
      setError(err as QueryError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Email"
      description="Used to sign in. Changing it needs your current password."
      onSubmit={submit}
    >
      <Field
        id="profile-email"
        label="Email"
        type="email"
        autoComplete="username"
        maxLength={EMAIL_MAX_LENGTH}
        value={email}
        onChange={(value) => {
          setEmail(value)
          setSaved(false)
          setError(undefined)
        }}
        error={
          emailTaken
            ? apiError?.message
            : (fieldErrors(error).email ?? undefined)
        }
      />

      {/*
        ⚠️ Rendered only while the address is actually changing. Asking for a
        password on a form the user has not touched is the prompt that teaches
        people to type their password into anything that asks.
      */}
      {dirty && (
        <Field
          id="profile-email-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          maxLength={PASSWORD_MAX_LENGTH}
          value={password}
          onChange={(value) => {
            setPassword(value)
            setError(undefined)
          }}
          error={badPassword ? apiError?.message : undefined}
        />
      )}

      <div className="flex items-center gap-3">
        <SubmitButton
          busy={busy}
          disabled={!dirty || password === ''}
          busyLabel="Saving…"
          inline
        >
          Save
        </SubmitButton>
        {saved && !dirty && <Saved message="Email updated." />}
      </div>

      {Boolean(error) && !emailTaken && !badPassword && (
        <FormError
          message={errorMessage(error, 'Could not save your email.')}
          code={apiError ?? undefined}
        />
      )}
    </Card>
  )
}

function PasswordCard({ change }: { change: ChangePassword }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  // `.unwrap()` rejects with the raw query error, which the helpers read.
  const [error, setError] = useState<QueryError>(undefined)

  const apiError = toApiError(error)
  const badPassword = apiError?.code === 'UNAUTHENTICATED'

  // Imported from contracts, never restated: `ChangePasswordDto` runs the same
  // function server-side, so this form cannot accept something the API rejects.
  const nextProblem = next === '' ? undefined : (passwordProblem(next) ?? undefined)
  const confirmProblem =
    confirm !== '' && confirm !== next ? 'Passwords do not match' : undefined
  const ready =
    current !== '' && next !== '' && !nextProblem && confirm === next

  const clear = () => {
    setSaved(false)
    setError(undefined)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(undefined)
    try {
      await change({ currentPassword: current, newPassword: next }).unwrap()
      // ⚠️ Never left in state after the request that used them, which is the
      // same rule the login and register forms follow.
      setCurrent('')
      setNext('')
      setConfirm('')
      setSaved(true)
    } catch (err) {
      setError(err as QueryError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Password"
      description="Changing it signs out your other devices. This one stays signed in."
      onSubmit={submit}
    >
      <Field
        id="profile-current-password"
        label="Current password"
        type="password"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={current}
        onChange={(value) => {
          setCurrent(value)
          clear()
        }}
        error={badPassword ? apiError?.message : undefined}
      />
      <Field
        id="profile-new-password"
        label="New password"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={next}
        onChange={(value) => {
          setNext(value)
          clear()
        }}
        error={nextProblem}
        hint="At least 8 characters, including a letter and a number."
      />
      <Field
        id="profile-confirm-password"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        maxLength={PASSWORD_MAX_LENGTH}
        value={confirm}
        onChange={(value) => {
          setConfirm(value)
          clear()
        }}
        error={confirmProblem}
        revealLabel={{
          show: 'Show password confirmation',
          hide: 'Hide password confirmation',
        }}
      />

      <div className="flex items-center gap-3">
        <SubmitButton
          busy={busy}
          disabled={!ready}
          busyLabel="Changing…"
          inline
        >
          Change password
        </SubmitButton>
        {saved && (
          <Saved message="Password changed. Other devices were signed out." />
        )}
      </div>

      {Boolean(error) && !badPassword && (
        <FormError
          message={errorMessage(error, 'Could not change your password.')}
          code={apiError ?? undefined}
        />
      )}
    </Card>
  )
}
