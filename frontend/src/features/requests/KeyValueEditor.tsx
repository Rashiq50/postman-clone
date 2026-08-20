import type { KeyValueEntry } from '@postman-clone/contracts'

const BLANK: KeyValueEntry = { key: '', value: '', enabled: true }

/**
 * The shared Params / Headers grid: `[✓ enabled] [key] [value] [×]`.
 *
 * There is no "Add row" button. A permanently-present blank trailing row
 * materialises into a real one on the first keystroke — Postman's behaviour,
 * and it removes both the button and the "I typed a row but forgot to add it"
 * failure.
 */
export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = 'Key',
}: {
  entries: KeyValueEntry[]
  onChange: (entries: KeyValueEntry[]) => void
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
                  <input
                    value={row.key}
                    placeholder={keyPlaceholder}
                    aria-label={`${keyPlaceholder} ${index + 1}`}
                    onChange={(e) => update(index, { key: e.target.value })}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs outline-none hover:border-line focus:border-accent"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    value={row.value}
                    placeholder="Value"
                    aria-label={`Value ${index + 1}`}
                    onChange={(e) => update(index, { value: e.target.value })}
                    className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-xs outline-none hover:border-line focus:border-accent"
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
