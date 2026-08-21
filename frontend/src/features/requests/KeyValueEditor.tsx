import type { KeyValueEntry } from '@raven/contracts'
import { VariableInput } from '../../components/ui/VariableInput'

const BLANK: KeyValueEntry = { key: '', value: '', enabled: true }

/**
 * The shared Params / Headers grid: `[✓ enabled] [key] [value] [×]`.
 *
 * There is no "Add row" button. A permanently-present blank trailing row
 * materialises into a real one on the first keystroke — Postman's behaviour,
 * and it removes both the button and the "I typed a row but forgot to add it"
 * failure.
 *
 * ⚠️ **Both cells are `VariableInput`s, keys included.** `applyEntries` in
 * `interpolate.ts` substitutes into the key as well as the value, so a chip on
 * one and not the other would misreport what the send path actually does.
 *
 * ⚠️ Each cell subscribes to the environment queries for itself rather than
 * taking a resolved map as a prop. The queries are already cached by the
 * header's picker so this costs a subscription, not a fetch — and the
 * alternative, threading a `Map` down, would give every row a new prop identity
 * on every environment edit. If a grid ever grows to hundreds of rows this is
 * the first thing to reach for a context.
 */
export function KeyValueEditor({
  entries,
  onChange,
  workspaceId,
  keyPlaceholder = 'Key',
}: {
  entries: KeyValueEntry[]
  onChange: (entries: KeyValueEntry[]) => void
  /** For resolving `{{variables}}` in the cells — see `VariableInput`. */
  workspaceId: string | undefined
  keyPlaceholder?: string
}) {
  const rows = [...entries, BLANK]

  const update = (index: number, changes: Partial<KeyValueEntry>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...changes } : row))
    // Drop the trailing blank again unless the user just typed into it.
    const last = next[next.length - 1]
    if (last.key === '' && last.value === '') next.pop()
    onChange(next)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="text-left text-xs text-fg-subtle">
            <th className="w-8 px-2 py-1" />
            <th className="px-2 py-1 font-medium">{keyPlaceholder}</th>
            <th className="px-2 py-1 font-medium">Value</th>
            <th className="w-8 px-2 py-1" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isBlankRow = index === rows.length - 1 && rows.length > entries.length
            return (
              <tr key={index} className="border-t border-line-subtle">
                <td className="px-2 py-1">
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    disabled={isBlankRow}
                    aria-label={`Enable row ${index + 1}`}
                    onChange={(e) => update(index, { enabled: e.target.checked })}
                    className="disabled:opacity-30"
                  />
                </td>
                <td className="px-2 py-1">
                  <VariableInput
                    value={row.key}
                    placeholder={keyPlaceholder}
                    label={`${keyPlaceholder} ${index + 1}`}
                    workspaceId={workspaceId}
                    onChange={(key) => update(index, { key })}
                    className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none hover:border-line focus:border-accent"
                  />
                </td>
                <td className="px-2 py-1">
                  <VariableInput
                    value={row.value}
                    placeholder="Value"
                    label={`Value ${index + 1}`}
                    workspaceId={workspaceId}
                    onChange={(value) => update(index, { value })}
                    className="w-full rounded border border-transparent bg-transparent px-2 py-1.5 font-mono text-sm outline-none hover:border-line focus:border-accent"
                  />
                </td>
                <td className="px-2 py-1">
                  {!isBlankRow && (
                    <button
                      type="button"
                      aria-label={`Remove row ${index + 1}`}
                      onClick={() =>
                        onChange(entries.filter((_, i) => i !== index))
                      }
                      className="rounded px-1 text-fg-faint hover:bg-danger-soft hover:text-danger"
                    >
                      <span aria-hidden>×</span>
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
