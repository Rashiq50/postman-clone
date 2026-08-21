import type {
  KeyValueEntry,
  RequestExecution,
  SendResult,
} from '@postman-clone/contracts'
import * as Tabs from '@radix-ui/react-tabs'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBlocker, useParams } from 'react-router'
import { errorMessage, type QueryError } from '../../lib/api-error'
import { requestPath } from '../tree/requestPath'
import { useGetTreeQuery } from '../tree/treeApi'
import { AuthTab } from './AuthTab'
import { BodyTab } from './BodyTab'
import { KeyValueEditor } from './KeyValueEditor'
import { RequestUrlBar } from './RequestUrlBar'
import { ResponsePane, type ResponseView } from './ResponsePane'
import { ScriptsTab } from './ScriptsTab'
import { useGetExecutionQuery } from './executionsApi'
import { useGetRequestQuery, useUpdateRequestMutation } from './requestsApi'
import { useRequestDraft } from './useRequestDraft'
import { useSendRequest } from './useSendRequest'

const TABS = ['Params', 'Headers', 'Body', 'Auth', 'Scripts'] as const
type Tab = (typeof TABS)[number]

/**
 * What the Params and Headers badges count: the rows that would actually be
 * sent. Counting `entries.length` instead would claim two headers while one of
 * them is unticked or still blank, which is worse than no badge at all.
 */
const activeCount = (entries: KeyValueEntry[]) =>
  entries.filter((entry) => entry.enabled && (entry.key !== '' || entry.value !== ''))
    .length

/**
 * ⚠️ Both badges below read `group-data-[state=active]` off the enclosing
 * `Tabs.Trigger` (which carries `group`) rather than taking an `isActive` prop.
 * The trigger already owns that state and publishes it as a data attribute; a
 * prop would be a second copy of it that can disagree.
 */
function CountBadge({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span className="rounded-full bg-surface-muted px-1.5 py-px text-[11px] font-semibold tabular-nums text-fg-muted transition group-data-[state=active]:bg-accent-soft group-data-[state=active]:text-accent-soft-fg">
      {count}
    </span>
  )
}

/** For the three tabs that have no count — a body, an auth scheme, a script. */
function FilledDot({ label }: { label: string }) {
  return (
    <>
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-fg-faint transition group-data-[state=active]:bg-accent"
      />
      <span className="sr-only">({label})</span>
    </>
  )
}

/**
 * Flattens a live `SendResult` or a stored `RequestExecution` into the one
 * shape the response pane renders.
 *
 * ⚠️ This function is why there is exactly **one** renderer for a fresh send
 * and a past run. Letting the pane branch on which it got would mean two
 * renderers for one concept, which is the same thing the two-outcome contract
 * exists to prevent one level down.
 */
function toResponseView(
  source: SendResult | RequestExecution | undefined,
): ResponseView | null {
  if (!source) return null

  // A `SendResult` nests its outcome; a stored row flattens it into columns.
  const isLive = 'result' in source
  const outcome = isLive ? source.result.outcome : source.outcome
  const live = isLive ? source.result : null

  return {
    outcome,
    status: live
      ? live.outcome === 'response'
        ? live.status
        : null
      : (source as RequestExecution).status,
    statusText: live
      ? live.outcome === 'response'
        ? live.statusText
        : null
      : (source as RequestExecution).statusText,
    failureKind: live
      ? live.outcome === 'failure'
        ? live.kind
        : null
      : (source as RequestExecution).failureKind,
    failureMessage: live
      ? live.outcome === 'failure'
        ? live.message
        : null
      : (source as RequestExecution).failureMessage,
    headers:
      live?.outcome === 'response'
        ? live.headers
        : ((source as RequestExecution).headers ?? []),
    body:
      live?.outcome === 'response'
        ? live.body
        : ((source as RequestExecution).body ?? { encoding: 'empty' }),
    bodyBytes:
      live?.outcome === 'response'
        ? live.bodyBytes
        : ((source as RequestExecution).bodyBytes ?? null),
    bodyTruncated:
      live?.outcome === 'response'
        ? live.bodyTruncated
        : ((source as RequestExecution).bodyTruncated ?? false),
    redirects: source.redirects,
    warnings: source.warnings,
    timing: source.timing,
    url: source.url,
  }
}

export function RequestEditor() {
  const { workspaceId, requestId } = useParams<{
    workspaceId: string
    requestId: string
  }>()

  const { data: request, isLoading, error } = useGetRequestQuery(requestId!, {
    skip: !requestId,
  })
  const [updateRequest, { isLoading: isSaving }] = useUpdateRequestMutation()

  // The breadcrumb's source. The sidebar is mounted beside this pane and
  // subscribes to the same query, so this is a second subscriber to a cached
  // response, not a second request. It deliberately does *not* opt into
  // `refetchOnFocus` — that belongs to the sidebar's hook, which owns the
  // reconcile.
  const { data: tree } = useGetTreeQuery(workspaceId!, { skip: !workspaceId })

  const { draft, patch, isDirty, changes, applySaved } = useRequestDraft(request)

  // A tab is not a location. Putting it in the URL would mean Back closes a
  // tab instead of leaving the request, which is not what Back means here.
  const [tab, setTab] = useState<Tab>('Params')

  // ⚠️ Keyed on the request id, not on `request`: RTK Query hands back a new
  // object on every background refetch, and resetting on that would throw the
  // user back to Params mid-edit. Same trap as `useRequestDraft`'s seeding.
  useEffect(() => setTab('Params'), [requestId])
  const [saveError, setSaveError] = useState<string | null>(null)

  const {
    run: send,
    cancel: cancelSend,
    reset: resetSend,
    result,
    error: sendError,
    isSending,
  } = useSendRequest(requestId)

  // Collapsed until the first send: an empty pane taking 45% of the editor
  // before anyone has pressed Send is dead space on every request opened.
  const [responseCollapsed, setResponseCollapsed] = useState(true)

  /** Non-null while the pane shows a stored run instead of the last send. */
  const [historyId, setHistoryId] = useState<string | null>(null)
  const { data: pastRun } = useGetExecutionQuery(historyId!, {
    skip: !historyId,
  })

  // ⚠️ Keyed on `requestId`, like every other reset in this pane: the previous
  // request's response must not linger under the next request's URL.
  useEffect(() => {
    resetSend()
    setHistoryId(null)
    setResponseCollapsed(true)
  }, [requestId, resetSend])

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

  /**
   * Sends the **draft**, not the saved row — see `RequestUrlBar`. The draft is
   * passed whether or not it is dirty; the server compares nothing and simply
   * records `usedDraft` when a draft was supplied, so this keeps "what you see
   * is what was sent" true without a second source of truth for dirtiness.
   */
  const runSend = () => {
    if (!draft) return
    setHistoryId(null)
    setResponseCollapsed(false)
    void send({
      method: draft.method,
      url: draft.url,
      headers: draft.headers,
      queryParams: draft.queryParams,
      body: draft.body,
      auth: draft.auth,
    })
  }

  // Ctrl/Cmd+S to save, Ctrl/Cmd+Enter to send. Bound on the window rather than
  // the form so both work wherever focus happens to be in the pane.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        runSend()
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
    return <EditorSkeleton />
  }

  if (error || !request || !draft) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded-lg border border-line bg-surface p-6 text-center glass-tint">
          <p className="text-sm font-medium text-fg">Request unavailable</p>
          <p className="mt-1 text-sm text-fg-subtle">
            {errorMessage(error, 'This request could not be found.')}
          </p>
        </div>
      </div>
    )
  }

  const path = requestPath(tree, request.id)

  const badges: Record<Tab, ReactNode> = {
    Params: <CountBadge count={activeCount(draft.queryParams)} />,
    Headers: <CountBadge count={activeCount(draft.headers)} />,
    Body: draft.body.mode === 'none' ? null : <FilledDot label="has a body" />,
    Auth:
      draft.auth.type === 'none' || draft.auth.type === 'inherit' ? null : (
        <FilledDot label="has auth" />
      ),
    Scripts:
      draft.scripts.preRequest.trim() || draft.scripts.postRequest.trim() ? (
        <FilledDot label="has scripts" />
      ) : null,
  }

  return (
    <div className="flex h-full flex-col bg-canvas">
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

      {/* The pane's chrome and its card take `glass-tint`: they sit on an
          opaque canvas, so there is nothing behind them a blur could reveal —
          only the layer it would cost. */}
      <header className="space-y-2.5 border-b border-line bg-surface px-4 py-3 glass-tint">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/*
              Where this request lives, which the pane otherwise never says —
              two requests called "Get user" in different collections are
              indistinguishable by their titles alone, and the sidebar only
              answers the question while the right subtree is expanded.

              ⚠️ The `h-4` is held whether or not there is a path to draw. The
              tree can arrive a moment after the request does, and a breadcrumb
              that appears late would shove the title down under the caret.
            */}
            <nav
              aria-label="Location"
              className="flex h-4 items-center gap-1 overflow-hidden px-2 text-xs text-fg-faint"
            >
              {path.map((name, index) => (
                <span key={index} className="flex min-w-0 items-center gap-1">
                  {index > 0 && (
                    <span aria-hidden className="text-line-strong">
                      /
                    </span>
                  )}
                  <span className="truncate">{name}</span>
                </span>
              ))}
            </nav>

            <input
              value={draft.name}
              aria-label="Request name"
              placeholder="Untitled request"
              onChange={(e) => patch({ name: e.target.value })}
              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-lg font-semibold text-fg outline-none placeholder:font-normal placeholder:text-fg-faint hover:border-line focus:border-accent"
            />
          </div>

          {/* ⚠️ A `role="status"` region, not a bare span: the whole point of it
              is that it changes while the user is typing somewhere else, so a
              screen reader has to hear about it without being moved there.
              `isSaving` is checked first because a request stays dirty until
              its response lands — otherwise the pill would read "Unsaved
              changes" throughout the save it is reporting on. */}
          <div role="status" aria-live="polite" className="shrink-0 pt-4 text-xs">
            {isSaving ? (
              <span className="text-fg-subtle">Saving…</span>
            ) : isDirty ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-1 font-medium text-warning-soft-fg">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
                Unsaved changes
              </span>
            ) : (
              <span className="text-fg-faint">Saved</span>
            )}
          </div>
        </div>

        <RequestUrlBar
          method={draft.method}
          url={draft.url}
          isDirty={isDirty}
          isSaving={isSaving}
          isSending={isSending}
          onMethodChange={(method) => patch({ method })}
          onUrlChange={(url) => patch({ url })}
          onSave={() => void save()}
          onSend={runSend}
          onCancelSend={cancelSend}
        />

        {saveError && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
          >
            <span aria-hidden>⚠</span>
            {saveError}
          </p>
        )}
      </header>

      {/*
        ⚠️ Radix `Tabs` for the roving focus, ←/→/Home/End, and the
        `tablist`/`tab`/`tabpanel` wiring — behaviour only. Every colour here is
        still a semantic token, so `yarn contrast` covers this surface exactly
        as it did when these were bare buttons.

        `min-h-0` on the root and the panel is load-bearing for the same reason
        it is on the workbench grid: without it the panel sizes to its content
        and the whole editor scrolls instead of the panel.
      */}
      {/*
        ⚠️ **`min-h-0` on this split container as well as on both of its
        children.** A flex child defaults to `min-height: auto`, so a single
        missing `min-h-0` anywhere in this chain makes the panes size to their
        content and the whole editor scroll instead. `WorkbenchShell`'s
        `<main>` already scrolls, so the symptom is a second scrollbar rather
        than an obviously broken layout — subtle enough to ship.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
      <Tabs.Root
        value={tab}
        onValueChange={(next) => setTab(next as Tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {/* ⚠️ **No `overflow-x-auto` here.** `overflow-x: auto` makes the *other*
            axis compute to `auto` as well, and the triggers' `-mb-px` — the
            pixel that lets an active underline swallow this list's hairline —
            overflows vertically by exactly that much. The result is a 1px
            scroll area that Windows paints as a full vertical scrollbar with
            arrows, floating in the tab strip. Five short tabs do not need
            scrolling; `shrink-0` keeps them from compressing instead, and a
            window narrow enough to overflow them scrolls at `<main>`, as it
            already did. */}
        <Tabs.List className="flex shrink-0 gap-1 border-b border-line bg-surface px-4 glass-tint">
          {TABS.map((name) => (
            <Tabs.Trigger
              key={name}
              value={name}
              className="group -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-fg-subtle transition hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus data-[state=active]:border-accent data-[state=active]:text-accent"
            >
              {name}
              {badges[name]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Inactive panels unmount, as they did under the old `&&` render.
            Every tab's state lives in the draft above, so nothing is lost.

            The panel is a card on `canvas` rather than content laid straight
            onto it: it separates the request's chrome from the part being
            edited, and it puts every label back onto `surface` — the
            background `yarn contrast` actually audits the foreground tokens
            against. */}
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <div className="rounded-lg border border-line bg-surface p-4 glass-tint">
            <Tabs.Content value="Params" className="focus-visible:outline-none">
              <KeyValueEditor
                entries={draft.queryParams}
                keyPlaceholder="Parameter"
                onChange={(queryParams) => patch({ queryParams })}
              />
            </Tabs.Content>
            <Tabs.Content value="Headers" className="focus-visible:outline-none">
              <KeyValueEditor
                entries={draft.headers}
                keyPlaceholder="Header"
                onChange={(headers) => patch({ headers })}
              />
            </Tabs.Content>
            <Tabs.Content value="Body" className="focus-visible:outline-none">
              <BodyTab body={draft.body} onChange={(body) => patch({ body })} />
            </Tabs.Content>
            <Tabs.Content value="Auth" className="focus-visible:outline-none">
              <AuthTab auth={draft.auth} onChange={(auth) => patch({ auth })} />
            </Tabs.Content>
            <Tabs.Content value="Scripts" className="focus-visible:outline-none">
              <ScriptsTab
                scripts={draft.scripts}
                onChange={(scripts) => patch({ scripts })}
              />
            </Tabs.Content>
          </div>
        </div>
      </Tabs.Root>

      <ResponsePane
        view={toResponseView(historyId ? pastRun : (result ?? undefined))}
        requestId={request.id}
        isSending={isSending}
        error={sendError}
        collapsed={responseCollapsed}
        onToggleCollapsed={() => setResponseCollapsed((open) => !open)}
        historyView={historyId ? { id: historyId } : null}
        onSelectHistory={(id) => {
          setHistoryId(id)
          setResponseCollapsed(false)
        }}
        onClearHistoryView={() => setHistoryId(null)}
      />
      </div>
    </div>
  )
}

/**
 * The loading state, shaped like the editor rather than centred on the word
 * "Loading…". Opening a request from the sidebar is the most frequent
 * navigation in the app, so a pane that blanks to one line of text is a
 * flicker the user sees dozens of times an hour; a skeleton of the same layout
 * holds the chrome still and fills in only the parts that arrive.
 */
function EditorSkeleton() {
  return (
    <div className="flex h-full flex-col bg-canvas" aria-busy>
      <span className="sr-only">Loading request…</span>

      <div className="space-y-2.5 border-b border-line bg-surface px-4 py-3 glass-tint">
        <div className="h-4 w-32 animate-pulse rounded bg-surface-muted" />
        <div className="h-7 w-64 animate-pulse rounded bg-surface-muted" />
        <div className="flex gap-2">
          <div className="h-9 w-24 shrink-0 animate-pulse rounded-md bg-surface-muted" />
          <div className="h-9 flex-1 animate-pulse rounded-md bg-surface-muted" />
          <div className="h-9 w-20 shrink-0 animate-pulse rounded-md bg-surface-muted" />
        </div>
      </div>

      <div className="flex gap-6 border-b border-line bg-surface px-4 py-3.5 glass-tint">
        {TABS.map((name) => (
          <div key={name} className="h-4 w-14 animate-pulse rounded bg-surface-muted" />
        ))}
      </div>

      <div className="p-4">
        <div className="h-48 animate-pulse rounded-lg border border-line bg-surface glass-tint" />
      </div>
    </div>
  )
}
