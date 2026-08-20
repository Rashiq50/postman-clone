import * as Tabs from '@radix-ui/react-tabs'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useEffect, useRef, useState } from 'react'
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

  // ⚠️ Keyed on the request id, not on `request`: RTK Query hands back a new
  // object on every background refetch, and resetting on that would throw the
  // user back to Params mid-edit. Same trap as `useRequestDraft`'s seeding.
  useEffect(() => setTab('Params'), [requestId])
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
   * ⚠️ The blocker stays *blocked* while the dialog is open — there is no local
   * "is the dialog showing" state, because `blocker.state` already is that
   * state, and a second copy could disagree with it. Every exit runs exactly
   * one of `proceed` or `reset`; leaving both uncalled wedges navigation
   * silently, which is the failure mode to watch for here.
   */
  const proceeded = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  )

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
      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Unsaved changes"
          message="Leaving now discards the edits to this request."
          confirmLabel="Discard and leave"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            proceeded.current = true
            blocker.proceed()
          }}
          // Escape and the overlay land here too, and staying put is the safe
          // default — a dismissed dialog cancels the navigation.
          //
          // ⚠️ `ConfirmDialog` calls `onClose` straight after `onConfirm`, and
          // the `blocker` in this closure is the one from the render that
          // opened it — so its `.state` still reads `'blocked'` even though
          // `proceed()` has just run. Without the ref this would call `reset()`
          // immediately after `proceed()` and the navigation would never
          // happen: the dialog closes, nothing moves, and it looks like the
          // button did nothing.
          onClose={() => {
            if (!proceeded.current) blocker.reset()
            proceeded.current = false
          }}
        />
      )}

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

      {/*
        ⚠️ Radix `Tabs` for the roving focus, ←/→/Home/End, and the
        `tablist`/`tab`/`tabpanel` wiring — behaviour only. Every colour here is
        still a semantic token, so `yarn contrast` covers this surface exactly
        as it did when these were bare buttons.

        `min-h-0` on the root and the panel is load-bearing for the same reason
        it is on the workbench grid: without it the panel sizes to its content
        and the whole editor scrolls instead of the panel.
      */}
      <Tabs.Root
        value={tab}
        onValueChange={(next) => setTab(next as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <Tabs.List className="flex gap-1 border-b border-line bg-surface px-4">
          {TABS.map((name) => (
            <Tabs.Trigger
              key={name}
              value={name}
              className="-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-fg-subtle transition hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus data-[state=active]:border-accent data-[state=active]:text-accent"
            >
              {name}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Inactive panels unmount, as they did under the old `&&` render.
            Every tab's state lives in the draft above, so nothing is lost. */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <Tabs.Content value="Params">
            <KeyValueEditor
              entries={draft.queryParams}
              keyPlaceholder="Parameter"
              onChange={(queryParams) => patch({ queryParams })}
            />
          </Tabs.Content>
          <Tabs.Content value="Headers">
            <KeyValueEditor
              entries={draft.headers}
              keyPlaceholder="Header"
              onChange={(headers) => patch({ headers })}
            />
          </Tabs.Content>
          <Tabs.Content value="Body">
            <BodyTab body={draft.body} onChange={(body) => patch({ body })} />
          </Tabs.Content>
          <Tabs.Content value="Auth">
            <AuthTab auth={draft.auth} onChange={(auth) => patch({ auth })} />
          </Tabs.Content>
          <Tabs.Content value="Scripts">
            <ScriptsTab
              scripts={draft.scripts}
              onChange={(scripts) => patch({ scripts })}
            />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  )
}
