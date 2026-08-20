import { HTTP_METHODS, type HttpMethod } from '@postman-clone/contracts'
import { Select } from '../../components/ui/Select'
import { methodStyles } from '../tree/methodStyles'

/**
 * Method + URL + Save.
 *
 * ⚠️ **There is no Send button, not even a disabled one.** Sending is a
 * separate slice — it carries its own security surface (SSRF, redirect
 * handling, timeouts, response size caps) and nothing here fires a request. A
 * disabled Send reads as broken software; an absent one reads as an unfinished
 * feature, which is the truth. Do not "helpfully" add it.
 */
export function RequestUrlBar({
  method,
  url,
  isDirty,
  isSaving,
  onMethodChange,
  onUrlChange,
  onSave,
}: {
  method: HttpMethod
  url: string
  isDirty: boolean
  isSaving: boolean
  onMethodChange: (method: HttpMethod) => void
  onUrlChange: (url: string) => void
  onSave: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      {/* The method keeps its colour in the trigger *and* in the list — the
          one place a coloured `<option>` would have been ignored outright.

          ⚠️ The trigger is a **fixed** width (`w-24`, sized to the longest
          method, `OPTIONS`) rather than content-sized. A content-sized trigger
          resizes on every method change, which shifts the URL field sideways
          under the caret. `shrink-0` stops the flex row taking it back on a
          narrow pane, and `justify-between` pins the ▾ to the right edge now
          that there is slack. */}
      <Select
        label="HTTP method"
        value={method}
        onValueChange={(next) => onMethodChange(next as HttpMethod)}
        triggerClassName={`w-24 shrink-0 justify-between py-2 font-mono text-xs font-semibold ${methodStyles[method]}`}
        entries={HTTP_METHODS.map((m) => ({
          value: m,
          label: m,
          className: `font-mono text-xs font-semibold ${methodStyles[m]}`,
        }))}
      />

      <input
        value={url}
        aria-label="Request URL"
        placeholder="https://api.example.com/users"
        spellCheck={false}
        onChange={(e) => onUrlChange(e.target.value)}
        className="min-w-0 flex-1 rounded-md border border-line-strong px-3 py-2 font-mono text-sm outline-none focus:border-accent"
      />

      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-40"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
