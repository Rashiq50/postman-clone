import {
  REQUEST_AUTH_TYPES,
  type RequestAuth,
  type RequestAuthType,
} from '@postman-clone/contracts'
import { useState } from 'react'
import { Select } from '../../components/ui/Select'
import { VariableInput } from '../../components/ui/VariableInput'

function emptyAuth(type: RequestAuthType): RequestAuth {
  switch (type) {
    case 'inherit':
      return { type: 'inherit' }
    case 'none':
      return { type: 'none' }
    case 'bearer':
      return { type: 'bearer', token: '' }
    case 'basic':
      return { type: 'basic', username: '', password: '' }
    case 'apiKey':
      return { type: 'apiKey', key: '', value: '', in: 'header' }
  }
}

const fieldClass =
  'w-full rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-accent'

/**
 * One auth field.
 *
 * ⚠️ A masked field is a `VariableInput` with `secret`, **not** an
 * `<input type="password">` — and the Show/Hide toggle is what makes that
 * honest rather than a downgrade. It mirrors the one on `LoginPage`, down to
 * the `aria-pressed`/`aria-controls` wiring, because a person who has just met
 * it there should not have to learn a second affordance here.
 *
 * The reason a token field of all things gets variable chips: a bearer token is
 * the single most likely value in the whole editor to be a `{{variable}}`,
 * because it is the one nobody wants committed to a shared collection. Masking
 * it as an opaque row of dots and giving no signal about whether it resolves is
 * how you end up sending the literal string `{{authToken}}` as your credential.
 */
function AuthField({
  label,
  value,
  onChange,
  workspaceId,
  secret = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  workspaceId: string | undefined
  secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const fieldId = `auth-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="relative">
        <VariableInput
          id={fieldId}
          value={value}
          onChange={onChange}
          workspaceId={workspaceId}
          label={label}
          secret={secret && !revealed}
          className={secret ? `${fieldClass} pr-16` : fieldClass}
        />
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((shown) => !shown)}
            aria-controls={fieldId}
            aria-pressed={revealed}
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
            className="absolute inset-y-0 right-0 rounded-r-md px-3 text-xs font-medium text-fg-subtle transition hover:text-fg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * ⚠️ The `type="password"` fields here are **cosmetic only**. These values are
 * stored and returned in plaintext — `GET /requests/:id` hands the token
 * straight back — which is what Postman does and an accepted trade-off for this
 * slice. The masking hides them from someone looking over your shoulder and
 * from nothing else. See the README; the fix is a write-only secrets table
 * with envelope encryption.
 */
export function AuthTab({
  auth,
  onChange,
  workspaceId,
}: {
  auth: RequestAuth
  onChange: (auth: RequestAuth) => void
  /** For resolving `{{variables}}` in the fields — see `VariableInput`. */
  workspaceId: string | undefined
}) {
  return (
    <div className="max-w-md space-y-3">
      <Select
        label="Auth type"
        value={auth.type}
        onValueChange={(next) => onChange(emptyAuth(next as RequestAuthType))}
        entries={REQUEST_AUTH_TYPES.map((type) => ({ value: type, label: type }))}
      />

      {auth.type === 'inherit' && (
        <p className="text-sm text-fg-faint">
          Inherits auth from the parent folder or collection.
        </p>
      )}

      {auth.type === 'none' && (
        <p className="text-sm text-fg-faint">
          This request sends no auth.
        </p>
      )}

      {auth.type === 'bearer' && (
        <AuthField
          label="Token"
          secret
          value={auth.token}
          workspaceId={workspaceId}
          onChange={(token) => onChange({ type: 'bearer', token })}
        />
      )}

      {auth.type === 'basic' && (
        <>
          <AuthField
            label="Username"
            value={auth.username}
            workspaceId={workspaceId}
            onChange={(username) => onChange({ ...auth, username })}
          />
          <AuthField
            label="Password"
            secret
            value={auth.password}
            workspaceId={workspaceId}
            onChange={(password) => onChange({ ...auth, password })}
          />
        </>
      )}

      {auth.type === 'apiKey' && (
        <>
          <AuthField
            label="Key"
            value={auth.key}
            workspaceId={workspaceId}
            onChange={(key) => onChange({ ...auth, key })}
          />
          <AuthField
            label="Value"
            secret
            value={auth.value}
            workspaceId={workspaceId}
            onChange={(value) => onChange({ ...auth, value })}
          />
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Add to</span>
            <Select
              label="Add to"
              value={auth.in}
              onValueChange={(next) =>
                onChange({ ...auth, in: next as 'header' | 'query' })
              }
              entries={[
                { value: 'header', label: 'Header' },
                { value: 'query', label: 'Query param' },
              ]}
            />
          </label>
        </>
      )}

      <p className="pt-2 text-xs text-fg-faint">
        Credentials are stored in plaintext in this version — see the README.
      </p>
    </div>
  )
}
