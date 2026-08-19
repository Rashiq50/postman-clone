import {
  REQUEST_BODY_MODES,
  type RequestBody,
  type RequestBodyMode,
} from '@postman-clone/contracts'
import { useState } from 'react'
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
 * A mode `<select>` and a plain `<textarea>`.
 *
 * No editor library. Adding one is a dependency, a bundle-size and a theming
 * decision that belongs with the execution slice, where syntax highlighting of
 * a *response* actually starts to earn it. The Format JSON button below is ten
 * lines and does most of what people actually miss, which is what keeps the
 * plain textarea feeling deliberate rather than unfinished.
 */
export function BodyTab({
  body,
  onChange,
}: {
  body: RequestBody
  onChange: (body: RequestBody) => void
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
        <select
          value={body.mode}
          aria-label="Body type"
          onChange={(e) => {
            setFormatError(null)
            onChange(emptyBody(e.target.value as RequestBodyMode))
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
        >
          {REQUEST_BODY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>

        {body.mode === 'json' && (
          <button
            type="button"
            onClick={format}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Format JSON
          </button>
        )}
      </div>

      {formatError && (
        <p className="text-sm text-red-600">Could not format: {formatError}</p>
      )}

      {body.mode === 'none' && (
        <p className="text-sm text-slate-400">This request has no body.</p>
      )}

      {(body.mode === 'raw' || body.mode === 'json') && (
        <textarea
          value={body.text}
          aria-label="Request body"
          spellCheck={false}
          rows={14}
          onChange={(e) => onChange({ mode: body.mode, text: e.target.value })}
          className="w-full rounded-md border border-slate-300 p-3 font-mono text-sm outline-none focus:border-indigo-500"
        />
      )}

      {body.mode === 'form-urlencoded' && (
        <KeyValueEditor
          entries={body.entries}
          keyPlaceholder="Field"
          onChange={(entries) => onChange({ mode: 'form-urlencoded', entries })}
        />
      )}
    </div>
  )
}
