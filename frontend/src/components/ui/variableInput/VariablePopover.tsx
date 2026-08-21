import type {
  Environment,
  EnvironmentVariable,
  ResolvedVariable,
} from '@raven/contracts'
import { useState } from 'react'
import { useUpdateEnvironmentMutation } from '../../../features/environments/environmentsApi'
import { usePanelAnchor } from './usePanelAnchor'

/**
 * Replaces the last row with `key`, or appends one.
 *
 * ⚠️ **The last** matching row, not the first: within one environment the last
 * duplicate key wins, matching the visual order of the editor rows and
 * `buildVariables`. Editing the first of two duplicates would appear to do
 * nothing, because the second still shadows it.
 *
 * A new row is added `enabled`, since the user asked for it by name.
 */
function withVariable(
  variables: EnvironmentVariable[],
  key: string,
  value: string,
): EnvironmentVariable[] {
  const index = variables.map((row) => row.key).lastIndexOf(key)
  if (index === -1) return [...variables, { key, value, enabled: true }]
  return variables.map((row, i) => (i === index ? { ...row, value } : row))
}

/**
 * What a `{{chip}}` is worth, on hover.
 *
 * Three states, and the third is the point: a variable that is **not defined**
 * gets an "Add to <environment>" affordance right here, because the alternative
 * is opening the environments dialog, finding the environment, adding a row and
 * coming back — for something the editor already knows the name of.
 *
 * ⚠️ Editing writes the **whole** `variables` array through
 * `updateEnvironment`, which is the endpoint's shape: the jsonb column is
 * replaced wholesale. Two people editing different variables in one environment
 * therefore last-write-wins, the same as the environments dialog, which is the
 * accepted behaviour of this slice rather than an oversight here.
 */
export function VariablePopover({
  anchor,
  name,
  resolved,
  environment,
  workspaceId,
  onDismiss,
  onMouseEnter,
  onMouseLeave,
}: {
  anchor: DOMRect
  name: string
  resolved: ResolvedVariable | undefined
  environment: Environment | undefined
  workspaceId: string
  onDismiss: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}) {
  const { panelRef, style } = usePanelAnchor(anchor, onDismiss)
  const [updateEnvironment, { isLoading }] = useUpdateEnvironmentMutation()

  const [editing, setEditing] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [draft, setDraft] = useState(resolved?.value ?? '')

  const masked = resolved?.secret === true && !revealed

  const save = async () => {
    if (!environment) return
    await updateEnvironment({
      id: environment.id,
      workspaceId,
      changes: { variables: withVariable(environment.variables, name, draft) },
    })
    setEditing(false)
    onDismiss()
  }

  return (
    <div
      ref={panelRef}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="z-50 w-72 rounded-md border border-line bg-surface p-3 shadow-lg glass"
    >
      <p className="mb-1 font-mono text-xs font-semibold text-fg">{name}</p>

      {!environment ? (
        <p className="text-xs text-fg-muted">
          No environment is selected, so nothing resolves. Pick one in the
          header.
        </p>
      ) : editing || !resolved ? (
        <>
          <p className="mb-2 text-xs text-fg-muted">
            {resolved ? (
              <>
                Editing in <span className="text-fg">{environment.name}</span>
              </>
            ) : (
              <>
                Not defined in{' '}
                <span className="text-fg">{environment.name}</span>
              </>
            )}
          </p>
          <input
            autoFocus
            value={draft}
            aria-label={`Value for ${name}`}
            placeholder="Value"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') onDismiss()
            }}
            className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="rounded px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={() => void save()}
              className="rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-40"
            >
              {resolved ? 'Save' : `Add to ${environment.name}`}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 break-all font-mono text-xs text-fg-muted">
            {masked ? '••••••••' : resolved.value || <em>(empty string)</em>}
          </p>
          <p className="text-[11px] text-fg-faint">
            from <span className="text-fg-muted">{environment.name}</span>
          </p>
          <div className="mt-2 flex justify-end gap-2">
            {resolved.secret && (
              // `secret` is a display hint only — the value is stored and sent
              // in plaintext regardless. This hides it from a shoulder, nothing
              // more, which is why revealing it costs one click and no warning.
              <button
                type="button"
                onClick={() => setRevealed((current) => !current)}
                className="rounded px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-muted"
              >
                {revealed ? 'Hide' : 'Reveal'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setDraft(resolved.value)
                setEditing(true)
              }}
              className="rounded px-2 py-1 text-xs text-fg-muted transition hover:bg-surface-muted"
            >
              Edit
            </button>
          </div>
        </>
      )}
    </div>
  )
}
