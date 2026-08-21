import type {
  RedirectHop,
  ResponseBodyPayload,
  ResponseHeader,
  SendTiming,
  SendWarning,
} from '@postman-clone/contracts'
import * as Tabs from '@radix-ui/react-tabs'
import { useState } from 'react'
import { HistoryPane } from './HistoryPane'
import {
  failureStyle,
  formatBytes,
  formatDuration,
  statusStyle,
} from './statusStyles'

/**
 * What the pane renders. Deliberately **not** `SendResult`: a live send and a
 * stored run must go through exactly one renderer, and this is the shape they
 * both flatten to. Two renderers for one concept is precisely what the
 * two-outcome contract exists to avoid.
 */
export interface ResponseView {
  outcome: 'response' | 'failure'
  status: number | null
  statusText: string | null
  failureKind: string | null
  failureMessage: string | null
  headers: ResponseHeader[]
  body: ResponseBodyPayload
  bodyBytes: number | null
  bodyTruncated: boolean
  redirects: RedirectHop[]
  warnings: SendWarning[]
  timing: SendTiming | null
  url: string
}

const PANE_TABS = ['Body', 'Headers', 'History'] as const
type PaneTab = (typeof PANE_TABS)[number]

function contentTypeOf(headers: ResponseHeader[]): string {
  return (
    headers.find((header) => header.name.toLowerCase() === 'content-type')
      ?.value ?? ''
  )
}

/**
 * Pretty-prints JSON, reusing `BodyTab`'s approach.
 *
 * ⚠️ **No editor library and no syntax highlighting**, which is the dependency
 * question `BodyTab` explicitly deferred *to this slice*. The answer is still
 * no: a plain `<pre>` plus a Pretty/Raw toggle covers what a person actually
 * does with a response, and CodeMirror or Monaco is a large, hard-to-reverse
 * dependency to buy indentation with.
 */
function prettify(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

function BodyView({
  body,
  headers,
  bodyBytes,
}: {
  body: ResponseBodyPayload
  headers: ResponseHeader[]
  bodyBytes: number | null
}) {
  const [pretty, setPretty] = useState(true)

  if (body.encoding === 'empty') {
    return <p className="p-4 text-sm text-fg-faint">No response body.</p>
  }

  if (body.encoding === 'base64') {
    const type = contentTypeOf(headers) || 'application/octet-stream'
    // Built at click time and revoked immediately after: a URL created on every
    // render would leak one object URL per render for a pane nobody downloads
    // from most of the time.
    const download = () => {
      const bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'response'
      anchor.click()
      URL.revokeObjectURL(url)
    }

    return (
      <div className="space-y-3 p-4">
        {/* ⚠️ Never the base64 blob rendered as text — a megabyte of it would
            lock the pane and tell the reader nothing. */}
        <p className="text-sm text-fg-muted">
          Binary response — {type.split(';')[0]}
          {bodyBytes !== null && `, ${formatBytes(bodyBytes)}`}
        </p>
        <button
          type="button"
          onClick={download}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-muted"
        >
          Download
        </button>
      </div>
    )
  }

  const prettified = prettify(body.text)

  return (
    <div className="flex h-full flex-col">
      {prettified !== null && (
        <div className="flex shrink-0 gap-1 px-3 pt-2">
          {(['Pretty', 'Raw'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPretty(mode === 'Pretty')}
              className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                pretty === (mode === 'Pretty')
                  ? 'bg-accent-soft text-accent-soft-fg'
                  : 'text-fg-subtle hover:bg-surface-muted'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg">
        {pretty && prettified !== null ? prettified : body.text}
      </pre>
    </div>
  )
}

function HeadersView({ headers }: { headers: ResponseHeader[] }) {
  if (headers.length === 0) {
    return <p className="p-4 text-sm text-fg-faint">No response headers.</p>
  }
  return (
    <table className="w-full text-left text-xs">
      <tbody>
        {headers.map((header, index) => (
          <tr key={index} className="border-b border-line-subtle align-top">
            <td className="w-1/3 px-3 py-1.5 font-mono font-medium text-fg-muted">
              {header.name}
            </td>
            <td className="px-3 py-1.5 font-mono break-all text-fg">
              {header.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * The response half of the editor's vertical split.
 *
 * ⚠️ **`min-h-0` on every flex child in the chain**, here and in the split
 * container above it. A flex child defaults to `min-height: auto`, so one
 * missing `min-h-0` makes the panes size to their content and the whole editor
 * scroll instead. `WorkbenchShell`'s `<main>` already scrolls, so the symptom
 * is a second scrollbar rather than an obviously broken layout — subtle enough
 * to ship.
 */
export function ResponsePane({
  view,
  requestId,
  isSending,
  error,
  collapsed,
  onToggleCollapsed,
  historyView,
  onSelectHistory,
  onClearHistoryView,
}: {
  view: ResponseView | null
  requestId: string
  isSending: boolean
  error: string | null
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Non-null while the pane is showing a stored run rather than the last send. */
  historyView: { id: string } | null
  onSelectHistory: (id: string) => void
  onClearHistoryView: () => void
}) {
  const [tab, setTab] = useState<PaneTab>('Body')

  return (
    <section
      className={`flex min-h-0 shrink-0 flex-col border-t border-line ${
        collapsed ? 'h-9' : 'basis-[45%]'
      }`}
      aria-label="Response"
    >
      <header className="flex h-9 shrink-0 items-center gap-3 bg-surface px-4 glass-tint">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="rounded px-1 text-xs text-fg-subtle transition hover:bg-surface-muted"
        >
          {collapsed ? '▸' : '▾'} Response
        </button>

        {isSending && <span className="text-xs text-fg-subtle">Sending…</span>}

        {!isSending && view && (
          <>
            {/* ⚠️ A failure gets **no status pill at all**. A `0` or `—` where a
                status code goes is the exact confusion the two-outcome
                contract exists to prevent. */}
            {view.outcome === 'response' && view.status !== null ? (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${statusStyle(view.status)}`}
              >
                {view.status} {view.statusText}
              </span>
            ) : (
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-semibold ${failureStyle}`}
              >
                {view.failureKind}
              </span>
            )}

            {view.timing && (
              <span className="text-xs text-fg-subtle tabular-nums">
                {formatDuration(view.timing.totalMs)}
              </span>
            )}
            {view.bodyBytes !== null && (
              <span className="text-xs text-fg-subtle tabular-nums">
                {formatBytes(view.bodyBytes)}
              </span>
            )}
            {view.redirects.length > 0 && (
              <span className="text-xs text-fg-faint">
                {view.redirects.length} redirect
                {view.redirects.length === 1 ? '' : 's'}
              </span>
            )}
          </>
        )}
      </header>

      {!collapsed && (
        <Tabs.Root
          value={tab}
          onValueChange={(next) => setTab(next as PaneTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List className="flex shrink-0 gap-1 border-b border-line bg-surface px-4 glass-tint">
            {PANE_TABS.map((name) => (
              <Tabs.Trigger
                key={name}
                value={name}
                className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-1.5 text-xs font-medium text-fg-subtle transition hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus data-[state=active]:border-accent data-[state=active]:text-accent"
              >
                {name}
              </Tabs.Trigger>
            ))}
          </Tabs.List>

          <div className="min-h-0 flex-1 overflow-auto">
            {/* ⚠️ Without this banner a user clicks a history row, sees a body,
                and believes their last Send returned it — the same class of bug
                as the Scripts banner. */}
            {historyView && tab !== 'History' && (
              <div className="flex items-center gap-2 border-b border-line bg-warning-soft px-3 py-1.5 text-xs text-warning-soft-fg">
                <span>Viewing a past run, not your last send.</span>
                <button
                  type="button"
                  onClick={onClearHistoryView}
                  className="rounded px-1.5 py-0.5 font-medium underline"
                >
                  Back to latest
                </button>
              </div>
            )}

            {error && tab !== 'History' && (
              <p
                role="alert"
                className="m-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
              >
                {error}
              </p>
            )}

            {view && view.warnings.length > 0 && tab !== 'History' && (
              <ul className="border-b border-line bg-warning-soft px-3 py-1.5 text-xs text-warning-soft-fg">
                {view.warnings.map((warning, index) => (
                  <li key={index}>{warning.message}</li>
                ))}
              </ul>
            )}

            <Tabs.Content value="Body" className="focus-visible:outline-none">
              {!view && !error && (
                <p className="p-4 text-sm text-fg-faint">
                  Press Send to make a request.
                </p>
              )}
              {view?.outcome === 'failure' && (
                <div className="m-3 rounded-md border border-danger-line bg-danger-soft p-3">
                  <p className="text-sm font-medium text-danger-soft-fg">
                    {view.failureKind}
                  </p>
                  <p className="mt-1 text-sm text-danger-soft-fg">
                    {view.failureMessage}
                  </p>
                </div>
              )}
              {view?.outcome === 'response' && (
                <BodyView
                  body={view.body}
                  headers={view.headers}
                  bodyBytes={view.bodyBytes}
                />
              )}
            </Tabs.Content>

            <Tabs.Content value="Headers" className="focus-visible:outline-none">
              {view ? (
                <HeadersView headers={view.headers} />
              ) : (
                <p className="p-4 text-sm text-fg-faint">No response yet.</p>
              )}
            </Tabs.Content>

            <Tabs.Content value="History" className="focus-visible:outline-none">
              <HistoryPane
                requestId={requestId}
                selectedId={historyView?.id ?? null}
                onSelect={onSelectHistory}
              />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      )}
    </section>
  )
}
