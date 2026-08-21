import { openPlaceholderAt } from '@raven/contracts'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useWorkspaceVariables } from '../../features/environments/useWorkspaceVariables'
import { VariablePopover } from './variableInput/VariablePopover'
import { VariableSuggestions } from './variableInput/VariableSuggestions'
import {
  caretOffset,
  caretRect,
  repaint,
  selectionOffsets,
} from './variableInput/caret'
import { useUndoStack, type Snapshot } from './variableInput/useUndoStack'

/**
 * A single-line text field that knows about `{{variables}}`.
 *
 * It paints each placeholder as a chip — accent when the active environment
 * defines it, danger when it does not — offers autocomplete as soon as `{{` is
 * typed, and shows the resolved value (with an inline edit, or an "add it" for
 * an undefined one) when a chip is hovered. Everything it knows comes from
 * `useWorkspaceVariables`, which merges through the **same** `buildVariables`
 * the send path uses, so a chip's verdict cannot disagree with the warning the
 * server would emit.
 *
 * It lives in `components/ui/` rather than in `features/requests/` because it
 * is heading for the Params and Headers cells and the Auth fields next; the URL
 * bar is only the first call site.
 *
 * ## Why a `contenteditable`
 *
 * The alternative was a transparent `<input>` over a pixel-matched mirror div.
 * This renders the chips in the same DOM the caret lives in, which is what
 * makes the suggestion list anchorable to the **caret** (a `Range` has a
 * rectangle; a mirror would have to re-measure the text) and what makes a chip
 * a real hover target instead of a coordinate lookup. The costs are paid here,
 * explicitly, and they are the three things to keep intact:
 *
 * 1. React must not own the children. The div is rendered empty and painted
 *    imperatively — re-rendering spans from JSX replaces the text nodes under
 *    the selection and drops the caret to the start on every keystroke.
 * 2. Chips are styled spans over the literal text, never atomic
 *    `contenteditable={false}` widgets. A character offset into the value is
 *    therefore also a character offset into the DOM, and the caret can sit
 *    *inside* a name — which autocomplete requires, since it filters on what
 *    has been typed so far.
 * 3. Undo is re-implemented (`useUndoStack`), because assigning `innerHTML`
 *    clears the native history.
 *
 * The one thing it cannot do is `type="password"`, which is why the Auth tab's
 * fields are not converted in this slice.
 */
export function VariableInput({
  id,
  value,
  onChange,
  workspaceId,
  label,
  placeholder,
  className = '',
  secret = false,
  onKeyDown,
}: {
  /** Only needed when something else must `aria-controls` this field. */
  id?: string
  value: string
  onChange: (value: string) => void
  /** Undefined outside a workspace route: chips then all read as undefined. */
  workspaceId: string | undefined
  /** `aria-label` — there is no `<label>` seam in the bars this sits in. */
  label: string
  placeholder?: string
  className?: string
  /**
   * Masks the glyphs, for the auth fields.
   *
   * ⚠️ Exactly as strong as the `type="password"` it replaces, which `AuthTab`
   * already documents as **cosmetic only**: the value is stored and returned in
   * plaintext by `GET /requests/:id` either way. It hides the token from
   * someone reading over your shoulder and from nothing else.
   *
   * A chip's *background* still shows through the mask, deliberately — knowing
   * that a masked token is `{{apiKey}}` rather than a literal is the whole
   * reason to put this component on an auth field at all.
   */
  secret?: boolean
  /** Bubbles keys the field did not consume (Ctrl+Enter to send, and so on). */
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const { variables, activeEnvironment, names } =
    useWorkspaceVariables(workspaceId)
  const isDefined = useCallback(
    (name: string) => variables.has(name),
    [variables],
  )

  const history = useUndoStack()
  const paintedVariables = useRef(variables)
  const composing = useRef(false)

  const [suggest, setSuggest] = useState<{
    rect: DOMRect
    start: number
    query: string
    index: number
  } | null>(null)
  const [popover, setPopover] = useState<{
    rect: DOMRect
    name: string
  } | null>(null)

  const matches = suggest
    ? names
        .filter((name) =>
          name.toLowerCase().includes(suggest.query.toLowerCase()),
        )
        // Prefix matches first: typing `ba` should offer `baseUrl` before
        // `dbHost` even though both contain those letters.
        .sort((a, b) => {
          const prefix = suggest.query.toLowerCase()
          const aPrefix = a.toLowerCase().startsWith(prefix)
          const bPrefix = b.toLowerCase().startsWith(prefix)
          return aPrefix === bPrefix ? 0 : aPrefix ? -1 : 1
        })
    : []

  const snapshot = useCallback((): Snapshot => {
    const host = hostRef.current
    const text = host?.textContent ?? value
    return { value: text, caret: (host && caretOffset(host)) ?? text.length }
  }, [value])

  /**
   * Writes a new value into the DOM, the caller and the caret in one act.
   *
   * Every mutation path — typing, paste, accepting a suggestion, undo — funnels
   * through here, so there is exactly one place that can get the ordering
   * wrong. And the ordering matters: paint first, then tell React, or the
   * effect below sees a mismatch and repaints a second time.
   */
  const commit = useCallback(
    (next: string, caret: number) => {
      const host = hostRef.current
      if (!host) return
      repaint(host, next, isDefined, caret)
      paintedVariables.current = variables
      onChange(next)
    },
    [isDefined, onChange, variables],
  )

  const closeSuggestions = useCallback(() => setSuggest(null), [])
  const closePopover = useCallback(() => setPopover(null), [])

  /**
   * Repaints on an *external* change: a different request opened, a draft
   * reseeded, or the active environment switched — which flips chips between
   * accent and danger without the value changing at all.
   *
   * It compares against the DOM rather than against a previous prop, because
   * the DOM is the thing that might be stale. And it only restores the caret
   * when the field is genuinely focused: repainting an unfocused input must
   * never steal focus, which is exactly what a background refetch would do
   * while the user types in another field.
   */
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const staleText = host.textContent !== value
    const staleChips = paintedVariables.current !== variables
    if (!staleText && !staleChips) return

    const focused = document.activeElement === host
    repaint(host, value, isDefined, focused ? caretOffset(host) : null)
    paintedVariables.current = variables
    if (staleText) {
      // A value that arrived from outside is not an edit, so there is nothing
      // sensible to undo back to.
      history.clear()
      setSuggest(null)
      setPopover(null)
    }
  }, [value, variables, isDefined, history])

  const refreshSuggestions = (text: string, caret: number) => {
    const host = hostRef.current
    if (!host) return
    const open = openPlaceholderAt(text, caret)
    if (!open) {
      setSuggest(null)
      return
    }
    setSuggest({
      rect: caretRect(host),
      start: open.start,
      query: open.query,
      index: 0,
    })
  }

  /**
   * ⚠️ Composition — IME, dead keys, mobile autocorrect — must not be repainted
   * mid-flight: replacing the text nodes under an active composition cancels it
   * and drops the characters. The value is reported to React as it arrives and
   * the chips catch up on `compositionend`.
   */
  const handleInput = () => {
    const host = hostRef.current
    if (!host) return
    const next = host.textContent ?? ''

    if (composing.current) {
      onChange(next)
      return
    }

    const caret = caretOffset(host) ?? next.length
    history.record({ value, caret })
    commit(next, caret)
    refreshSuggestions(next, caret)
    setPopover(null)
  }

  const accept = (name: string) => {
    const host = hostRef.current
    if (!host || !suggest) return
    const text = host.textContent ?? ''
    const caret = caretOffset(host) ?? text.length
    // Don't leave a second `}}` behind when completing inside `{{ba|}}`.
    const tail = text.slice(caret, caret + 2) === '}}' ? caret + 2 : caret
    const next = `${text.slice(0, suggest.start)}{{${name}}}${text.slice(tail)}`

    history.record({ value: text, caret })
    commit(next, suggest.start + name.length + 4)
    setSuggest(null)
  }

  const applySnapshot = (snap: Snapshot | null) => {
    if (!snap) return
    commit(snap.value, snap.caret)
    setSuggest(null)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const meta = event.ctrlKey || event.metaKey

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      applySnapshot(
        event.shiftKey ? history.redo(snapshot()) : history.undo(snapshot()),
      )
      return
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      applySnapshot(history.redo(snapshot()))
      return
    }

    if (suggest && matches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setSuggest({
          ...suggest,
          index: (suggest.index + delta + matches.length) % matches.length,
        })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        accept(matches[suggest.index] ?? matches[0]!)
        return
      }
    }

    if (event.key === 'Escape' && suggest) {
      // Stopped rather than bubbled: an Escape that closes the list must not
      // also close the dialog this field may one day sit in.
      event.preventDefault()
      event.stopPropagation()
      setSuggest(null)
      return
    }

    // Single line. A newline in a URL is never wanted, and it would break the
    // "the value is exactly what you see" premise the offsets rely on.
    if (event.key === 'Enter' && !meta) event.preventDefault()

    onKeyDown?.(event)
  }

  /**
   * ⚠️ Paste is intercepted rather than left to the browser, for two reasons:
   * `plaintext-only` is not universally honoured for rich clipboard payloads,
   * so styled HTML could otherwise land inside the field; and a multi-line
   * paste — the common case, a URL copied out of a terminal with a trailing
   * newline — has to collapse rather than turn the field into two lines.
   */
  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault()
    const host = hostRef.current
    if (!host) return
    const pasted = event.clipboardData
      .getData('text/plain')
      .replace(/\s*\r?\n\s*/g, ' ')
      .trim()

    const text = host.textContent ?? ''
    const range = selectionOffsets(host) ?? {
      start: text.length,
      end: text.length,
    }
    const next = text.slice(0, range.start) + pasted + text.slice(range.end)
    const caret = range.start + pasted.length

    history.record({ value: text, caret: range.start })
    commit(next, caret)
    refreshSuggestions(next, caret)
  }

  /**
   * Hover is delegated from the host, so a chip costs nothing to be hoverable:
   * there are no per-chip listeners to reattach on every repaint.
   *
   * The open and close delays are a pair. Without the close delay the popover
   * vanishes as the pointer crosses the gap towards it, which makes its Edit
   * and Add buttons unreachable — the same class of bug as a submenu that
   * closes diagonally.
   */
  const hoverTimer = useRef<number | undefined>(undefined)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimer.current !== undefined) window.clearTimeout(hoverTimer.current)
    hoverTimer.current = undefined
  }, [])

  useEffect(() => clearHoverTimer, [clearHoverTimer])

  const handleMouseOver = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suggest) return
    const chip = (event.target as HTMLElement).closest('[data-var]')
    if (!(chip instanceof HTMLElement)) return
    const name = chip.dataset.var ?? ''
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => {
      setPopover({ rect: chip.getBoundingClientRect(), name })
    }, 250)
  }

  const scheduleClose = useCallback(() => {
    clearHoverTimer()
    hoverTimer.current = window.setTimeout(() => setPopover(null), 200)
  }, [clearHoverTimer])

  return (
    <>
      <div
        ref={hostRef}
        id={id}
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        role="combobox"
        aria-label={label}
        aria-expanded={suggest !== null}
        aria-controls={suggest ? listId : undefined}
        aria-activedescendant={
          suggest && matches.length > 0
            ? `${listId}-${suggest.index}`
            : undefined
        }
        aria-autocomplete="list"
        aria-multiline="false"
        spellCheck={false}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => {
          composing.current = true
        }}
        onCompositionEnd={() => {
          composing.current = false
          handleInput()
        }}
        onBlur={closeSuggestions}
        onMouseOver={handleMouseOver}
        onMouseLeave={scheduleClose}
        className={`variable-input${
          secret ? ' variable-input-secret' : ''
        } ${className}`}
      />

      {suggest && (
        <VariableSuggestions
          id={listId}
          anchor={suggest.rect}
          names={matches}
          variables={variables}
          activeIndex={suggest.index}
          onPick={accept}
          onDismiss={closeSuggestions}
        />
      )}

      {popover && workspaceId && (
        <VariablePopover
          anchor={popover.rect}
          name={popover.name}
          resolved={variables.get(popover.name)}
          environment={activeEnvironment}
          workspaceId={workspaceId}
          onDismiss={closePopover}
          onMouseEnter={clearHoverTimer}
          onMouseLeave={scheduleClose}
        />
      )}
    </>
  )
}
