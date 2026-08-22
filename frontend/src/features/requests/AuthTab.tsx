import {
  REQUEST_AUTH_TYPES,
  type RequestAuth,
  type RequestAuthType,
} from '@raven/contracts'
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
    case 'unsupported':
      /*
       * ⚠️ Unreachable in practice — the Select below never offers this unless
       * it is already the value, so nothing can switch *into* it. The branch
       * exists because the switch is exhaustive over `RequestAuthType`, which
       * is what turns a future auth variant into a compile error here. The
       * scheme is a placeholder that no user path can produce.
       */
      return { type: 'unsupported', scheme: 'oauth2', params: [] }
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
      {/*
        ⚠️ `unsupported` is offered **only when it is already the value**.
        Nothing can author one — it exists so an imported oauth2/awsv4/digest
        request keeps its credentials instead of silently becoming "none" — and
        a dropdown entry that a user can pick, which then sends nothing, is a
        worse lie than no entry at all. Keeping it in the list while it *is* the
        value is what stops Radix rendering a blank trigger with no placeholder.
      */}
      <Select
        label="Auth type"
        value={auth.type}
        onValueChange={(next) => onChange(emptyAuth(next as RequestAuthType))}
        entries={REQUEST_AUTH_TYPES.filter(
          (type) => type !== 'unsupported' || auth.type === 'unsupported',
        ).map((type) => ({
          value: type,
          label:
            type === 'unsupported'
              ? `${auth.type === 'unsupported' ? auth.scheme : 'unsupported'} (imported)`
              : type,
        }))}
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

      {auth.type === 'unsupported' && (
        <div className="space-y-3">
          {/*
            The `ScriptsTab` banner pattern: a stored-but-inert feature says so
            where the user is looking at it, rather than surprising them with a
            401 from the target and nothing anywhere connecting the two. The
            send path warns as well — both, because only one of them is visible
            before you press Send.
          */}
          <p className="rounded-md border border-line bg-surface-muted px-3 py-2 text-sm text-fg-muted">
            <span className="font-medium text-fg">
              {auth.scheme} auth was imported and stored, but is not sent.
            </span>{' '}
            The values below are kept exactly as they arrived so nothing is
            lost. Sending this request sends no auth — switch to a supported
            type to change that.
          </p>

          {auth.params.length === 0 ? (
            <p className="text-sm text-fg-faint">
              No parameters were recorded for this scheme.
            </p>
          ) : (
            /*
              Read-only, and a table rather than disabled inputs: there is no
              editor for a scheme we cannot send, and a form the user can type
              into implies a save that would mean something.
            */
            <div className="overflow-x-auto">
              <table className="w-full min-w-[24rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-fg-subtle">
                    <th className="px-2 py-1 font-medium">Parameter</th>
                    <th className="px-2 py-1 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {auth.params.map((param) => (
                    <tr
                      key={param.key}
                      className="border-t border-line-subtle align-top"
                    >
                      <td className="px-2 py-1 font-mono text-xs text-fg-muted">
                        {param.key}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs break-all">
                        {param.value}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="pt-2 text-xs text-fg-faint">
        Credentials are stored in plaintext in this version — see the README.
      </p>
    </div>
  )
}
