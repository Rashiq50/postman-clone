import {
  REQUEST_BODY_MODES,
  type RequestBody,
  type RequestBodyMode,
} from '@raven/contracts'
import { useState } from 'react'
import { CodeEditor } from '../../components/ui/CodeEditor'
import { Select } from '../../components/ui/Select'
import { KeyValueEditor } from './KeyValueEditor'

/** Switching mode keeps nothing: each branch of the union has its own fields. */
function emptyBody(mode: RequestBodyMode): RequestBody {
  switch (mode) {
    case 'none':
      return { mode: 'none' }
    case 'raw':
      return { mode: 'raw', text: '' }
    case 'json':
      return { mode: 'json', text: '' }
    case 'form-urlencoded':
      return { mode: 'form-urlencoded', entries: [] }
  }
}

/**
 * A mode dropdown and a code editor.
 *
 * ⚠️ **This is the one place in the app that uses CodeMirror, and the reasoning
 * for it lives in [CodeEditor.tsx](../../components/ui/CodeEditor.tsx).** The
 * short version: the *response* pane needed colour only, and got a ~120-line
 * tokenizer with no dependency ([jsonSyntax.ts](jsonSyntax.ts)); a body is
 * typed into, and keeping a highlight layer in register with a caret, a
 * selection, wrapping and IME composition is the part that is not worth
 * hand-writing. Both halves paint through the same `--syntax-*` tokens.
 *
 * Format JSON stays. It is ten lines, it is what people actually reach for,
 * and it is the reason the editor needs no formatter extension.
 */
export function BodyTab({
  body,
  onChange,
  workspaceId,
}: {
  body: RequestBody
  onChange: (body: RequestBody) => void
  /**
   * Forwarded to the form-urlencoded grid, whose cells resolve `{{variables}}`.
   *
   * ⚠️ The editor below is deliberately **not** a `VariableInput`, and
   * CodeMirror does not change that. Resolving `{{variables}}` there means a
   * `ViewPlugin` with its own decoration set and a hover tooltip — a feature,
   * not a styling detail, and one that would need the environment data this
   * component does not receive. Variables still interpolate into the body when
   * it is sent; they are simply not marked up here.
   */
  workspaceId: string | undefined
}) {
  const [formatError, setFormatError] = useState<string | null>(null)

  const format = () => {
    if (body.mode !== 'json') return
    try {
      onChange({ mode: 'json', text: JSON.stringify(JSON.parse(body.text), null, 2) })
      setFormatError(null)
    } catch (error) {
      setFormatError(error instanceof Error ? error.message : 'Invalid JSON')
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select
          label="Body type"
          value={body.mode}
          onValueChange={(next) => {
            setFormatError(null)
            onChange(emptyBody(next as RequestBodyMode))
          }}
          entries={REQUEST_BODY_MODES.map((mode) => ({ value: mode, label: mode }))}
        />

        {body.mode === 'json' && (
          <button
            type="button"
            onClick={format}
            className="rounded-md border border-line-strong px-2 py-1.5 text-sm text-fg-muted hover:bg-surface-muted"
          >
            Format JSON
          </button>
        )}
      </div>

      {formatError && (
        <p className="text-sm text-danger">Could not format: {formatError}</p>
      )}

      {body.mode === 'none' && (
        <p className="text-sm text-fg-faint">This request has no body.</p>
      )}

      {(body.mode === 'raw' || body.mode === 'json') && (
        /*
         * ⚠️ The border and the focus ring live on this wrapper, not inside the
         * editor. CodeMirror renders its own focusable `contenteditable`, so a
         * `focus:` utility would never match — `focus-within` is what makes the
         * control read as focused, and it is what keeps this looking like the
         * app's other inputs rather than like an embedded IDE.
         *
         * The height is fixed and `overflow-hidden` clips to the radius: the
         * editor scrolls internally, so a body of any length leaves the tab
         * card the same size and the Send button where the user left it.
         */
        <div className="h-64 overflow-hidden rounded-md border border-line-strong transition-colors focus-within:border-accent">
          <CodeEditor
            value={body.text}
            language={body.mode === 'json' ? 'json' : 'text'}
            ariaLabel="Request body"
            placeholderText={
              body.mode === 'json' ? '{ "key": "value" }' : 'Request body'
            }
            onChange={(text) => onChange({ mode: body.mode, text })}
          />
        </div>
      )}

      {body.mode === 'form-urlencoded' && (
        <KeyValueEditor
          entries={body.entries}
          keyPlaceholder="Field"
          workspaceId={workspaceId}
          onChange={(entries) => onChange({ mode: 'form-urlencoded', entries })}
        />
      )}
    </div>
  )
}
