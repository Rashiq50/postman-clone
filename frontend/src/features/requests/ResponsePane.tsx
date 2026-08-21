import type {
  RedirectHop,
  ResponseBodyPayload,
  ResponseHeader,
  SendTiming,
  SendWarning,
} from "@raven/contracts";
import * as Tabs from "@radix-ui/react-tabs";
import { useMemo, useRef, useState } from "react";
import { HistoryPane } from "./HistoryPane";
import {
  HIGHLIGHT_MAX_CHARS,
  SYNTAX_CLASS,
  tokenizeJson,
} from "./jsonSyntax";
import { ResponseActions } from "./ResponseActions";
import { contentTypeOf, downloadResponse, headersAsText } from "./responseFile";
import {
  failureStyle,
  formatBytes,
  formatDuration,
  statusStyle,
} from "./statusStyles";
import { ChevronIcon } from "../tree/NodeIcon";

/**
 * What the pane renders. Deliberately **not** `SendResult`: a live send and a
 * stored run must go through exactly one renderer, and this is the shape they
 * both flatten to. Two renderers for one concept is precisely what the
 * two-outcome contract exists to avoid.
 */
export interface ResponseView {
  outcome: "response" | "failure";
  status: number | null;
  statusText: string | null;
  failureKind: string | null;
  failureMessage: string | null;
  headers: ResponseHeader[];
  body: ResponseBodyPayload;
  bodyBytes: number | null;
  bodyTruncated: boolean;
  redirects: RedirectHop[];
  warnings: SendWarning[];
  timing: SendTiming | null;
  url: string;
}

const PANE_TABS = ["Body", "Headers", "History"] as const;
type PaneTab = (typeof PANE_TABS)[number];

/**
 * Pretty-prints JSON.
 *
 * ⚠️ It doubles as the pane's **"is this JSON?" test**, which is why its
 * `null` return is threaded down as `canPretty` rather than being swallowed
 * here: the Pretty/Raw toggle and the syntax highlighting are gated on exactly
 * the same answer, and deriving that answer twice is how they would come to
 * disagree — a body prettified but uncoloured, or the reverse.
 *
 * ⚠️ **Still no editor library on this side.** The pane is read-only, so it
 * needs a tokenizer and not an editor; that is [jsonSyntax.ts](jsonSyntax.ts),
 * which is ~120 lines and no dependency. CodeMirror is in the app now, for the
 * request body in `BodyTab` — mounting a second instance here to render text
 * nobody can type into would buy nothing and cost the pane its `<pre>`.
 */
function prettify(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

function BodyView({
  body,
  headers,
  bodyBytes,
  displayed,
  canPretty,
  pretty,
  onPrettyChange,
}: {
  body: ResponseBodyPayload;
  headers: ResponseHeader[];
  bodyBytes: number | null;
  /** The text to render, already resolved against the Pretty/Raw toggle. */
  displayed: string;
  canPretty: boolean;
  pretty: boolean;
  onPrettyChange: (pretty: boolean) => void;
}) {
  const text = body.encoding === "text" ? displayed : "";
  const tooLargeToHighlight = text.length > HIGHLIGHT_MAX_CHARS;

  /**
   * ⚠️ Above the early returns, and memoized on the displayed text.
   *
   * Above, because `empty` and `base64` bodies return before the `<pre>` and a
   * hook after them would change the hook order between two response bodies —
   * the classic version of this bug, and one that only fires on the *second*
   * send. Memoized, because the pane re-renders on every parent state change
   * (the drag handle alone dispatches on every pointermove), and re-tokenizing
   * a 100 kB body per frame while someone resizes the split is exactly the
   * stall the cap exists to prevent.
   */
  const tokens = useMemo(
    () => (canPretty && !tooLargeToHighlight ? tokenizeJson(text) : null),
    [canPretty, tooLargeToHighlight, text],
  );

  if (body.encoding === "empty") {
    return <p className="p-4 text-sm text-fg-faint">No response body.</p>;
  }

  if (body.encoding === "base64") {
    const type = contentTypeOf(headers) || "application/octet-stream";

    return (
      <div className="space-y-3 p-4">
        {/* ⚠️ Never the base64 blob rendered as text — a megabyte of it would
            lock the pane and tell the reader nothing. */}
        <p className="text-sm text-fg-muted">
          Binary response — {type.split(";")[0]}
          {bodyBytes !== null && `, ${formatBytes(bodyBytes)}`}
        </p>
        {/*
          The header toolbar's Download does the same thing, and deliberately so
          — it is the *only* action available for a binary body, and a row of
          6px icons is not where a reader with nothing else to click will look.
          Both call `downloadResponse`, so there is one implementation.
        */}
        <button
          type="button"
          onClick={() => downloadResponse(body, headers)}
          className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition hover:bg-surface-muted"
        >
          Download
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {canPretty && (
        <div className="flex shrink-0 gap-1 px-3 pt-2">
          {(["Pretty", "Raw"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onPrettyChange(mode === "Pretty")}
              className={`rounded px-2 py-0.5 text-xs font-medium transition ${
                pretty === (mode === "Pretty")
                  ? "bg-accent-soft text-accent-soft-fg"
                  : "text-fg-subtle hover:bg-surface-muted"
              }`}
            >
              {mode}
            </button>
          ))}

          {/* ⚠️ Said out loud rather than silently degrading. Highlighting that
              works on one response and not the next, with no explanation, reads
              as "the pane failed to recognise this as JSON" — which would be a
              lie about the data instead of a statement about the size. */}
          {canPretty && tooLargeToHighlight && (
            <span className="self-center pl-2 text-xs text-fg-faint">
              Highlighting off — over {Math.round(HIGHLIGHT_MAX_CHARS / 1000)} kB
            </span>
          )}
        </div>
      )}
      <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-fg">
        {/* ⚠️ `plain` tokens are bare strings, not `<span>`s. Indentation is the
            most common token in a prettified document by a wide margin, so
            wrapping it would roughly double the node count to colour nothing. */}
        {tokens
          ? tokens.map((token, index) =>
              token.kind === "plain" ? (
                token.text
              ) : (
                <span key={index} className={SYNTAX_CLASS[token.kind]}>
                  {token.text}
                </span>
              ),
            )
          : displayed}
      </pre>
    </div>
  );
}

function HeadersView({ headers }: { headers: ResponseHeader[] }) {
  if (headers.length === 0) {
    return <p className="p-4 text-sm text-fg-faint">No response headers.</p>;
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
  );
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
  onClear,
}: {
  view: ResponseView | null;
  requestId: string;
  isSending: boolean;
  error: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Non-null while the pane is showing a stored run rather than the last send. */
  historyView: { id: string } | null;
  onSelectHistory: (id: string) => void;
  onClearHistoryView: () => void;
  /** Discards whatever the pane is showing — the live result *and* any past run. */
  onClear: () => void;
}) {
  const [tab, setTab] = useState<PaneTab>("Body");

  /**
   * ⚠️ The Pretty/Raw choice lives here, not in `BodyView`, because the header's
   * Copy and Download must hand over **what is on screen**. A toggle owned by
   * the view would leave the toolbar copying raw text while the user reads the
   * prettified version — which looks like a bug in the formatter, not in Copy.
   */
  const [pretty, setPretty] = useState(true);

  const bodyText = view?.body.encoding === "text" ? view.body.text : null;
  const prettified = bodyText === null ? null : prettify(bodyText);
  const displayedBody =
    bodyText === null
      ? ""
      : pretty && prettified !== null
        ? prettified
        : bodyText;

  /**
   * What the toolbar acts on, per tab. A failure has no body, so Copy hands
   * over the failure itself — which is the thing a person pastes into a bug
   * report.
   */
  const copyText = (() => {
    if (!view) return null;
    if (tab === "Headers") {
      return view.headers.length > 0 ? headersAsText(view.headers) : null;
    }
    if (tab !== "Body") return null;
    if (view.outcome === "failure") {
      return `${view.failureKind}: ${view.failureMessage}`;
    }
    // `displayedBody`, not `bodyText` — see the note on `pretty` above.
    return bodyText === null ? null : displayedBody;
  })();

  const canDownload =
    tab !== "History" && view !== null && view.body.encoding !== "empty";

  /**
   * The user-dragged height in px; `null` means the default `basis-[45%]`.
   * In-memory only, like the tab — a pane height is not worth a storage key.
   * It survives collapse/expand so reopening lands where the user left it.
   */
  const [height, setHeight] = useState<number | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  /** Keep at least a strip of pane and at least 10rem of editor above it. */
  const clampHeight = (next: number) => {
    const parent = sectionRef.current?.parentElement;
    const max = parent ? parent.clientHeight - 160 : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(next, 96), Math.max(max, 96));
  };

  // Pointer capture instead of window listeners: move/up keep firing on the
  // handle even once the pointer leaves it, and there is nothing to clean up
  // on unmount because nothing global was attached.
  const onHandlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const section = sectionRef.current;
    if (!section) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: section.offsetHeight,
    };
  };

  const onHandlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    // The pane hangs from the bottom, so dragging *up* grows it.
    setHeight(
      clampHeight(active.startHeight + (active.startY - event.clientY)),
    );
  };

  const onHandlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
  };

  return (
    <section
      ref={sectionRef}
      className={`flex min-h-0 shrink-0 flex-col border-t border-line ${
        collapsed ? "h-9" : height === null ? "basis-[45%]" : ""
      }`}
      style={!collapsed && height !== null ? { height } : undefined}
      aria-label="Response"
    >
      {/* The resize handle: a thin strip riding the pane's top edge. Hidden
          while collapsed — a 36px strip has nothing meaningful to resize.
          Keyboard users get the same affordance through arrow keys, and a
          double-click returns to the default split. */}
      {!collapsed && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize response pane"
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onDoubleClick={() => setHeight(null)}
          onKeyDown={(event) => {
            const section = sectionRef.current;
            if (!section) return;
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const delta = event.key === "ArrowUp" ? 24 : -24;
              setHeight(clampHeight(section.offsetHeight + delta));
            }
          }}
          className="-mt-px h-1 shrink-0 cursor-row-resize touch-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        />
      )}
      <header className="flex h-9 shrink-0 items-center gap-3 bg-surface px-4 glass-tint">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="rounded px-1 text-xs text-fg-subtle transition hover:bg-surface-muted flex justify-center gap-1"
        >
          <span>
            <ChevronIcon expanded={!collapsed} />
          </span>
          <span>Response</span>
        </button>

        {isSending && <span className="text-xs text-fg-subtle">Sending…</span>}

        {!isSending && view && (
          <div className="flex gap-4 ml-auto items-center">
            {/* ⚠️ A failure gets **no status pill at all**. A `0` or `—` where a
                status code goes is the exact confusion the two-outcome
                contract exists to prevent. */}
            {view.outcome === "response" && view.status !== null ? (
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
                {view.redirects.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {/*
          ⚠️ The toolbar is rendered while collapsed too, and that is on purpose:
          the collapsed header still names a status, so the response it belongs
          to is still "there" and clearing or copying it are still meaningful.
          `ml-auto` pins it right, away from the status metadata on the left.
        */}
        <div className="">
          <ResponseActions
            copyText={collapsed ? null : copyText}
            onDownload={
              canDownload && view
                ? () => downloadResponse(view.body, view.headers)
                : null
            }
            onClear={onClear}
            canClear={view !== null || error !== null}
          />
        </div>
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
            {historyView && tab !== "History" && (
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

            {error && tab !== "History" && (
              <p
                role="alert"
                className="m-3 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-soft-fg"
              >
                {error}
              </p>
            )}

            {view && view.warnings.length > 0 && tab !== "History" && (
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
              {view?.outcome === "failure" && (
                <div className="m-3 rounded-md border border-danger-line bg-danger-soft p-3">
                  <p className="text-sm font-medium text-danger-soft-fg">
                    {view.failureKind}
                  </p>
                  <p className="mt-1 text-sm text-danger-soft-fg">
                    {view.failureMessage}
                  </p>
                </div>
              )}
              {view?.outcome === "response" && (
                <BodyView
                  body={view.body}
                  headers={view.headers}
                  bodyBytes={view.bodyBytes}
                  displayed={displayedBody}
                  canPretty={prettified !== null}
                  pretty={pretty}
                  onPrettyChange={setPretty}
                />
              )}
            </Tabs.Content>

            <Tabs.Content
              value="Headers"
              className="focus-visible:outline-none"
            >
              {view ? (
                <HeadersView headers={view.headers} />
              ) : (
                <p className="p-4 text-sm text-fg-faint">No response yet.</p>
              )}
            </Tabs.Content>

            <Tabs.Content
              value="History"
              className="focus-visible:outline-none"
            >
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
  );
}
