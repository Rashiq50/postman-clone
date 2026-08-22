import {
  REQUEST_BODY_MODES,
  type FormDataEntry,
  type KeyValueEntry,
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
    case 'xml':
      return { mode: 'xml', text: '' }
    case 'graphql':
      return { mode: 'graphql', query: '', variables: '' }
    case 'form-data':
      return { mode: 'form-data', entries: [] }
    case 'binary':
      return { mode: 'binary', src: '' }
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

  /**
   * The GraphQL variables editor gets its own Format, because it is a second
   * JSON document on the same screen — sharing one button would leave the
   * user guessing which editor it acts on.
   */
  const formatVariables = () => {
    if (body.mode !== 'graphql') return
    try {
      onChange({
        ...body,
        variables: JSON.stringify(JSON.parse(body.variables), null, 2),
      })
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

      {(body.mode === 'raw' ||
        body.mode === 'json' ||
        body.mode === 'xml') && (
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
            /*
             * ⚠️ `xml` is edited as plain text, deliberately. Highlighting it
             * means `@codemirror/lang-xml`, and **nothing is added on the
             * strength of "we already have CodeMirror"** — the rule recorded
             * with the six packages that arrived with it. An imported SOAP
             * body is legible without colour; a seventh package is a decision
             * to take on purpose, not a side effect of this slice.
             */
            language={body.mode === 'json' ? 'json' : 'text'}
            ariaLabel="Request body"
            placeholderText={
              body.mode === 'json'
                ? '{ "key": "value" }'
                : body.mode === 'xml'
                  ? '<root></root>'
                  : 'Request body'
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

      {body.mode === 'graphql' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <span className="text-xs font-medium text-fg-muted">Query</span>
            <div className="h-48 overflow-hidden rounded-md border border-line-strong transition-colors focus-within:border-accent">
              <CodeEditor
                value={body.query}
                language="text"
                ariaLabel="GraphQL query"
                placeholderText="query { }"
                onChange={(query) => onChange({ ...body, query })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                Variables
              </span>
              <button
                type="button"
                onClick={formatVariables}
                className="rounded-md border border-line-strong px-2 py-1 text-xs text-fg-muted hover:bg-surface-muted"
              >
                Format JSON
              </button>
            </div>
            {/*
              ⚠️ Stored as raw *text*, not as a parsed object — Postman does the
              same, and an in-progress edit is routinely not valid JSON. The
              send path parses it, and warns rather than failing when it
              cannot.
            */}
            <div className="h-32 overflow-hidden rounded-md border border-line-strong transition-colors focus-within:border-accent">
              <CodeEditor
                value={body.variables}
                language="json"
                ariaLabel="GraphQL variables"
                placeholderText="{ }"
                onChange={(variables) => onChange({ ...body, variables })}
              />
            </div>
          </div>
        </div>
      )}

      {body.mode === 'form-data' && (
        <div className="space-y-2">
          {/*
            ⚠️ `KeyValueEditor` is reused rather than forked, and the row `type`
            is merged back **positionally** in `onChange`. The grid knows
            nothing about a `type` field, so the alternative was a second grid
            that would then drift from this one on every future change. A row
            the grid appends has no counterpart in `entries` and becomes
            `'text'`, which is the only thing a user can author here.
          */}
          <KeyValueEditor
            entries={body.entries.map(
              ({ key, value, enabled }): KeyValueEntry => ({
                key,
                value,
                enabled,
              }),
            )}
            keyPlaceholder="Field"
            workspaceId={workspaceId}
            onChange={(entries) =>
              onChange({
                mode: 'form-data',
                entries: entries.map(
                  (entry, index): FormDataEntry => ({
                    ...entry,
                    type: body.entries[index]?.type ?? 'text',
                  }),
                ),
              })
            }
          />
          {body.entries.some((entry) => entry.type === 'file') && (
            <p className="text-xs text-fg-faint">
              File fields hold the path recorded by the import — no file is
              attached, and this body is not sent yet.
            </p>
          )}
        </div>
      )}

      {body.mode === 'binary' && (
        /*
         * A read-only panel rather than a file picker: there is no upload
         * endpoint and no storage answer behind one, so a picker here would be
         * a control that cannot do the thing it appears to offer.
         */
        <div className="space-y-1 rounded-md border border-line-strong bg-surface-muted px-3 py-2">
          <span className="text-xs font-medium text-fg-muted">File</span>
          <p className="truncate font-mono text-sm" title={body.src}>
            {body.src || 'No file path recorded.'}
          </p>
          <p className="text-xs text-fg-faint">
            Imported as a path only. Binary bodies are not sent yet.
          </p>
        </div>
      )}
    </div>
  )
}
