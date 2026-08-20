import {
  REQUEST_AUTH_TYPES,
  type RequestAuth,
  type RequestAuthType,
} from '@postman-clone/contracts'

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
  'w-full rounded-md border border-line-strong px-3 py-2 font-mono text-sm outline-none focus:border-accent'

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
}: {
  auth: RequestAuth
  onChange: (auth: RequestAuth) => void
}) {
  return (
    <div className="max-w-md space-y-3">
      <select
        value={auth.type}
        aria-label="Auth type"
        onChange={(e) => onChange(emptyAuth(e.target.value as RequestAuthType))}
        className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
      >
        {REQUEST_AUTH_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

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
        <label className="block space-y-1">
          <span className="text-xs font-medium text-fg-muted">Token</span>
          <input
            type="password"
            value={auth.token}
            onChange={(e) => onChange({ type: 'bearer', token: e.target.value })}
            className={fieldClass}
          />
        </label>
      )}

      {auth.type === 'basic' && (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Username</span>
            <input
              value={auth.username}
              onChange={(e) =>
                onChange({ ...auth, username: e.target.value })
              }
              className={fieldClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Password</span>
            <input
              type="password"
              value={auth.password}
              onChange={(e) =>
                onChange({ ...auth, password: e.target.value })
              }
              className={fieldClass}
            />
          </label>
        </>
      )}

      {auth.type === 'apiKey' && (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Key</span>
            <input
              value={auth.key}
              onChange={(e) => onChange({ ...auth, key: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Value</span>
            <input
              type="password"
              value={auth.value}
              onChange={(e) => onChange({ ...auth, value: e.target.value })}
              className={fieldClass}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">Add to</span>
            <select
              value={auth.in}
              onChange={(e) =>
                onChange({ ...auth, in: e.target.value as 'header' | 'query' })
              }
              className="rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              <option value="header">Header</option>
              <option value="query">Query param</option>
            </select>
          </label>
        </>
      )}

      <p className="pt-2 text-xs text-fg-faint">
        Credentials are stored in plaintext in this version — see the README.
      </p>
    </div>
  )
}
