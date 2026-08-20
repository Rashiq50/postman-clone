import { useEffect, useState } from 'react'
import { useBlocker, useParams } from 'react-router'
import { errorMessage, type QueryError } from '../../lib/api-error'
import { AuthTab } from './AuthTab'
import { BodyTab } from './BodyTab'
import { KeyValueEditor } from './KeyValueEditor'
import { RequestUrlBar } from './RequestUrlBar'
import { ScriptsTab } from './ScriptsTab'
import { useGetRequestQuery, useUpdateRequestMutation } from './requestsApi'
import { useRequestDraft } from './useRequestDraft'

const TABS = ['Params', 'Headers', 'Body', 'Auth', 'Scripts'] as const
type Tab = (typeof TABS)[number]

export function RequestEditor() {
  const { workspaceId, requestId } = useParams<{
    workspaceId: string
    requestId: string
  }>()

  const { data: request, isLoading, error } = useGetRequestQuery(requestId!, {
    skip: !requestId,
  })
  const [updateRequest, { isLoading: isSaving }] = useUpdateRequestMutation()

  const { draft, patch, isDirty, changes, applySaved } = useRequestDraft(request)

  // A tab is not a location. Putting it in the URL would mean Back closes a
  // tab instead of leaving the request, which is not what Back means here.
  const [tab, setTab] = useState<Tab>('Params')
  const [saveError, setSaveError] = useState<string | null>(null)

  const save = async () => {
    if (!requestId || !workspaceId || !isDirty) return
    setSaveError(null)
    try {
      // Only the fields that actually changed — which is what lets
      // `updateRequest` skip invalidating the tree unless the sidebar's
      // `name`/`method` are among them.
      const saved = await updateRequest({
        id: requestId,
        workspaceId,
        changes,
      }).unwrap()
      applySaved(saved)
    } catch (err) {
      // `.unwrap()` rejects with the raw query error, which `errorMessage`
      // already knows how to read.
      setSaveError(errorMessage(err as QueryError, 'Could not save this request.'))
    }
  }

  // Ctrl/Cmd+S. Bound on the window rather than the form so it works wherever
  // focus happens to be in the pane.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  /**
   * ⚠️ **No autosave.** Autosave plus a tree that invalidates on renames is a
   * refetch storm — every keystroke in the name field would refetch the whole
   * workspace. Unsaved work is guarded here instead.
   *
   * `window.confirm` is a labelled placeholder; a real dialog is deferred.
   */
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('You have unsaved changes. Leave without saving?')) {
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker])

  if (isLoading) {
    return <p className="p-6 text-sm text-fg-faint">Loading…</p>
  }

  if (error || !request || !draft) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-fg-subtle">
          {errorMessage(error, 'This request could not be found.')}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line bg-surface px-4 py-3">
        <input
          value={draft.name}
          aria-label="Request name"
          onChange={(e) => patch({ name: e.target.value })}
          className="w-full rounded-md border border-transparent px-1 py-1 text-lg font-medium text-fg outline-none hover:border-line focus:border-accent"
        />

        <RequestUrlBar
          method={draft.method}
          url={draft.url}
          isDirty={isDirty}
          isSaving={isSaving}
          onMethodChange={(method) => patch({ method })}
          onUrlChange={(url) => patch({ url })}
          onSave={() => void save()}
        />

        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>

      <div className="flex gap-1 border-b border-line bg-surface px-4">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setTab(name)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === name
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-subtle hover:text-fg'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === 'Params' && (
          <KeyValueEditor
            entries={draft.queryParams}
            keyPlaceholder="Parameter"
            onChange={(queryParams) => patch({ queryParams })}
          />
        )}
        {tab === 'Headers' && (
          <KeyValueEditor
            entries={draft.headers}
            keyPlaceholder="Header"
            onChange={(headers) => patch({ headers })}
          />
        )}
        {tab === 'Body' && (
          <BodyTab body={draft.body} onChange={(body) => patch({ body })} />
        )}
        {tab === 'Auth' && (
          <AuthTab auth={draft.auth} onChange={(auth) => patch({ auth })} />
        )}
        {tab === 'Scripts' && (
          <ScriptsTab
            scripts={draft.scripts}
            onChange={(scripts) => patch({ scripts })}
          />
        )}
      </div>
    </div>
  )
}
