import { HTTP_METHODS, type HttpMethod } from '@postman-clone/contracts'
import { Select } from '../../components/ui/Select'
import { VariableInput } from '../../components/ui/VariableInput'
import { methodStyles } from '../tree/methodStyles'

/**
 * Method + URL + Send + Save.
 *
 * **Send is the primary action of this bar** and sits to the left of Save,
 * which stepped down to a secondary style: sending is what a person opens this
 * app to do, and saving is how they keep what they built.
 *
 * What Send does: interpolates `{{variables}}` from the caller's active
 * environment, resolves the hostname and screens **every** address it answers
 * with, pins the connection to a screened address, follows redirects manually
 * (re-screening each hop and stripping credentials across origins), and caps
 * both the response size and the total time.
 *
 * What it deliberately does **not** do: run the pre/post scripts (they are
 * stored and never executed — see `ScriptsTab`), keep a cookie jar, stream, or
 * cancel server-side. Those are separate decisions with their own reasons,
 * recorded in SEND_PLAN.md.
 *
 * ⚠️ **Send is not gated on `isDirty`, and it sends the draft.** There is no
 * autosave, so gating it on a clean draft would make the pane feel broken —
 * and firing the *last saved* request while the user looks at their edits is
 * the single most confusing behaviour available here. The server records
 * `usedDraft` so the history row cannot silently claim something was sent that
 * was never saved.
 */
export function RequestUrlBar({
  method,
  url,
  workspaceId,
  isDirty,
  isSaving,
  isSending,
  onMethodChange,
  onUrlChange,
  onSave,
  onSend,
  onCancelSend,
}: {
  method: HttpMethod
  url: string
  /** For resolving `{{variables}}` in the field — see `VariableInput`. */
  workspaceId: string | undefined
  isDirty: boolean
  isSaving: boolean
  isSending: boolean
  onMethodChange: (method: HttpMethod) => void
  onUrlChange: (url: string) => void
  onSave: () => void
  onSend: () => void
  /** Stops waiting. ⚠️ The upstream call still finishes — see `useSendRequest`. */
  onCancelSend: () => void
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

      {/* Not a plain `<input>`: `{{variables}}` are painted as chips that say
          whether the active environment defines them, and typing `{{` offers
          the names it does. The URL is where that matters most — an unresolved
          placeholder here is left literal, fails `new URL()` and comes back as
          `invalid-url`, so knowing before pressing Send is the whole point. */}
      <VariableInput
        value={url}
        onChange={onUrlChange}
        workspaceId={workspaceId}
        label="Request URL"
        placeholder="https://api.example.com/users"
        className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-fg outline-none transition hover:border-fg-faint focus:border-accent"
      />

      {/* Enabled whenever there is a URL to send to — nothing else. */}
      <button
        type="button"
        onClick={isSending ? onCancelSend : onSend}
        disabled={!isSending && url.trim() === ''}
        title="Send (Ctrl+Enter / ⌘Enter)"
        className="shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSending ? 'Cancel' : 'Send'}
      </button>

      {/* Secondary now that Send owns the accent. The shortcut lives in
          `title` rather than in the label: a `⌘S` badge inside the button would
          be wrong on Windows and right on macOS, and the same handler answers
          to both. `cursor-not-allowed` matters here because the button spends
          most of its life disabled — a click on a 40%-opacity control
          otherwise gives no feedback at all. */}
      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        title="Save (Ctrl+S / ⌘S)"
        className="shrink-0 rounded-md border border-line-strong bg-surface px-4 py-2 text-sm font-medium text-fg-muted transition hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
