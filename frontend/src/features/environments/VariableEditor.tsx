import type { EnvironmentVariable } from '@raven/contracts'

const BLANK: EnvironmentVariable = {
  key: '',
  value: '',
  enabled: true,
  secret: false,
}

/**
 * The environment variables grid: `[✓ enabled] [key] [value] [secret] [×]`.
 *
 * Written fresh rather than widening [KeyValueEditor](../requests/KeyValueEditor.tsx)
 * with an optional fourth column — a decision, not an omission.
 * `KeyValueEditor` is mounted in the two hottest tabs in the app, and
 * `EnvironmentVariable` is a different type with a different optional field;
 * threading a `secret` column through it would put a branch in the render path
 * of every header row to serve a dialog that is open a few seconds a week. The
 * small duplication is the cheaper trade.
 *
 * The trailing-blank-row behaviour is copied deliberately, because it is the
 * part users have already learned from the Params and Headers tabs.
 *
 * ⚠️ A `secret` variable renders `type="password"` — **cosmetic only**, exactly
 * as in `AuthTab`. The value is stored and returned in plaintext, and it is
 * redacted only in what history *stores*. Treat the mask as a shoulder-surfing
 * courtesy, never as protection.
 */
export function VariableEditor({
  variables,
  onChange,
}: {
  variables: EnvironmentVariable[]
  onChange: (variables: EnvironmentVariable[]) => void
}) {
  const rows = [...variables, BLANK]

  const update = (index: number, changes: Partial<EnvironmentVariable>) => {
    const next = rows.map((row, i) =>
      i === index ? { ...row, ...changes } : row,
    )
    const last = next[next.length - 1]
    if (last.key === '' && last.value === '') next.pop()
    onChange(next)
  }

  const remove = (index: number) => {
    onChange(variables.filter((_, i) => i !== index))
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th className="w-8 px-2 py-1" />
            <th className="px-2 py-1 font-medium">Variable</th>
            <th className="px-2 py-1 font-medium">Value</th>
            <th className="w-16 px-2 py-1 font-medium">Secret</th>
            <th className="w-8 px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isBlankRow =
              index === rows.length - 1 && rows.length > variables.length
            return (
              <tr key={index} className="border-t border-line-subtle">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={isBlankRow}
                    aria-label={`Enable variable ${index + 1}`}
                    onChange={(event) =>
                      update(index, { enabled: event.target.checked })
                    }
                    className="disabled:opacity-30"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={row.key}
                    placeholder="baseUrl"
                    aria-label={`Variable name ${index + 1}`}
                    onChange={(event) =>
                      update(index, { key: event.target.value })
                    }
                    className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={row.value}
                    // Cosmetic only — see the note above.
                    type={row.secret ? 'password' : 'text'}
                    placeholder="https://api.example.com"
                    aria-label={`Variable value ${index + 1}`}
                    onChange={(event) =>
                      update(index, { value: event.target.value })
                    }
                    className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-fg outline-none focus:border-accent"
                  />
                </td>
                <td className="px-2 py-1 text-center">
                  <input
                    type="checkbox"
                    checked={row.secret === true}
                    disabled={isBlankRow}
                    aria-label={`Mark variable ${index + 1} secret`}
                    onChange={(event) =>
                      update(index, { secret: event.target.checked })
                    }
                    className="disabled:opacity-30"
                  />
                </td>
                <td className="px-2 py-1">
                  {!isBlankRow && (
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      aria-label={`Remove variable ${index + 1}`}
                      className="rounded px-1 text-fg-faint transition hover:bg-surface-muted hover:text-fg-muted"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
