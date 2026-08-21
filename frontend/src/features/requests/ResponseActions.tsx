import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * The response pane's header toolbar: copy, download, clear.
 *
 * ⚠️ **Icon buttons, and therefore every one of them carries both an
 * `aria-label` and a `title`.** The label is what a screen reader announces;
 * the `title` is what a sighted user gets on hover, and without it a row of
 * unlabelled glyphs is a guessing game. A tooltip library is not worth buying
 * for three buttons — the same call `NodeMenu` makes about a dropdown library.
 *
 * ⚠️ **They act on what is on screen, not on the last send.** The pane also
 * renders stored runs from History, and a Copy that quietly returned the live
 * result while the user was looking at a past one would be the same class of
 * bug the "viewing a past run" banner exists to prevent. Everything here is fed
 * from the single `ResponseView` the pane is already rendering.
 */

const SVG_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const

function CopyIcon() {
  return (
    <svg {...SVG_PROPS} className="size-3.5">
      <rect x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" />
      <path d="M10.25 3.6V3.5a1.25 1.25 0 0 0-1.25-1.25H4.25A1.25 1.25 0 0 0 3 3.5v5a1.25 1.25 0 0 0 1.25 1.25h.1" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...SVG_PROPS} strokeWidth={1.9} className="size-3.5">
      <path d="m3.25 8.5 3.1 3.1 6.4-7.2" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg {...SVG_PROPS} className="size-3.5">
      <path d="M8 2.5v7.25" />
      <path d="m5 7 3 3 3-3" />
      <path d="M2.75 11.75v.75a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-.75" />
    </svg>
  )
}

/** A slashed circle, not a bin: this discards a view, it deletes nothing. */
function ClearIcon() {
  return (
    <svg {...SVG_PROPS} className="size-3.5">
      <circle cx="8" cy="8" r="5.5" />
      <path d="m4.75 4.75 6.5 6.5" />
    </svg>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-6 items-center justify-center rounded text-fg-subtle transition hover:bg-surface-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:text-fg-disabled disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

type CopyState = 'idle' | 'copied' | 'failed'

export function ResponseActions({
  copyText,
  onDownload,
  onClear,
  canClear,
}: {
  /** What Copy writes — null disables it (a binary body, an empty tab). */
  copyText: string | null
  /** Null disables Download (nothing to save). */
  onDownload: (() => void) | null
  onClear: () => void
  canClear: boolean
}) {
  const [copied, setCopied] = useState<CopyState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ⚠️ The confirmation is a timeout, so it can outlive the pane — navigating
  // to another request while it is up unmounts this button mid-flight.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = async () => {
    if (copyText === null) return
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied('copied')
    } catch {
      // `navigator.clipboard` is undefined on an insecure origin and can be
      // refused by permissions policy. Saying so beats a button that looks
      // broken.
      setCopied('failed')
    }
    timer.current = setTimeout(() => setCopied('idle'), 1500)
  }

  return (
    <div className="flex items-center gap-0.5">
      {/* The confirmation is visual (the tick) and, for a screen reader, this
          live region — the icon swap alone announces nothing. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied === 'copied'
          ? 'Copied to clipboard'
          : copied === 'failed'
            ? 'Could not copy to clipboard'
            : ''}
      </span>

      <IconButton
        label={
          copied === 'copied'
            ? 'Copied'
            : copied === 'failed'
              ? 'Could not copy'
              : 'Copy to clipboard'
        }
        onClick={() => void copy()}
        disabled={copyText === null}
      >
        {copied === 'copied' ? <CheckIcon /> : <CopyIcon />}
      </IconButton>

      <IconButton
        label="Download response"
        onClick={() => onDownload?.()}
        disabled={onDownload === null}
      >
        <DownloadIcon />
      </IconButton>

      <IconButton label="Clear response" onClick={onClear} disabled={!canClear}>
        <ClearIcon />
      </IconButton>
    </div>
  )
}
