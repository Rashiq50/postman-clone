import { tokenize } from '@postman-clone/contracts'

/**
 * The DOM plumbing behind `VariableInput` — pure functions over a root element,
 * kept out of the component so the component reads as behaviour rather than as
 * range arithmetic.
 *
 * The whole design rests on one property: **a character offset into the value
 * string is also a character offset into the element's text nodes.** That holds
 * because the chips are ordinary styled spans wrapping the literal `{{name}}`
 * text — no `contenteditable={false}`, no zero-width joiners, no hidden nodes.
 * Break that and every function here silently drifts by a character or two,
 * which presents as a caret that jumps one place left as you type.
 */

/**
 * Class names per chip state.
 *
 * Green for resolved and red for unresolved, rather than the accent colour for
 * resolved: this is a **verdict**, not a highlight, and the pair a reader
 * already knows means pass/fail is the one to spend here. The accent is the
 * app's "this is interactive" colour and would have said the wrong thing.
 *
 * ⚠️ Both pairs are semantic tokens that `check-contrast.mjs` already audits
 * (`success-soft-fg on success-soft`, `danger-soft-fg on danger-soft`) in every
 * theme. A hand-picked green here would be the one element on the page that
 * ignores the theme, and it would be unchecked rather than passing.
 */
const CHIP_BASE =
  'rounded-[3px] px-[2px] py-[1px] outline outline-1 outline-offset-0'

const CHIP_STATE = {
  ok: `${CHIP_BASE} bg-success-soft text-success-soft-fg outline-transparent`,
  missing: `${CHIP_BASE} bg-danger-soft text-danger-soft-fg outline-danger-line`,
} as const

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * The highlighted markup for a value.
 *
 * ⚠️ `escapeHtml` is not optional and not cosmetic. The value is arbitrary user
 * text assigned through `innerHTML`, so a URL containing `<img onerror=...>`
 * would otherwise execute. Only the tokeniser's own spans are markup; every
 * other character is escaped text.
 *
 * ⚠️ A trailing newline or a value ending in a space needs no special casing
 * *because* the element is single-line and white-space is `pre`: the browser
 * renders a trailing space and keeps the caret after it.
 */
export function paintHtml(
  value: string,
  isDefined: (name: string) => boolean,
): string {
  return tokenize(value)
    .map((token) => {
      if (token.kind === 'text') return escapeHtml(token.text)
      const state = isDefined(token.name) ? 'ok' : 'missing'
      return (
        `<span data-var="${escapeHtml(token.name)}" data-state="${state}"` +
        ` data-start="${token.start}" class="${CHIP_STATE[state]}">` +
        `${escapeHtml(token.text)}</span>`
      )
    })
    .join('')
}

/** Every text node under `root`, in document order. */
function textNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node = walker.nextNode()
  while (node) {
    nodes.push(node as Text)
    node = walker.nextNode()
  }
  return nodes
}

/**
 * A (node, offset) pair as a plain character offset into `root.textContent`.
 *
 * Handles a container that is an element rather than a text node — which is
 * what a selection reports for an empty field, and after `select all + delete`.
 */
export function offsetOf(root: Node, node: Node, nodeOffset: number): number {
  if (node === root) {
    // An element container: `nodeOffset` counts child *nodes*, not characters.
    let total = 0
    for (let i = 0; i < nodeOffset && i < root.childNodes.length; i += 1) {
      total += root.childNodes[i].textContent?.length ?? 0
    }
    return total
  }

  let total = 0
  for (const text of textNodes(root)) {
    if (text === node) return total + nodeOffset
    total += text.length
  }
  // The node is not under `root` — treat it as past the end rather than as
  // zero, since the only way here is a stale reference after a repaint.
  return total
}

/** The inverse: a character offset as a `Range` positioned inside `root`. */
export function rangeAt(root: Node, offset: number): Range {
  const range = document.createRange()
  const nodes = textNodes(root)

  if (nodes.length === 0) {
    range.setStart(root, 0)
    range.collapse(true)
    return range
  }

  let remaining = offset
  for (const text of nodes) {
    if (remaining <= text.length) {
      range.setStart(text, remaining)
      range.collapse(true)
      return range
    }
    remaining -= text.length
  }

  const last = nodes[nodes.length - 1]
  range.setStart(last, last.length)
  range.collapse(true)
  return range
}

/** Where the caret is, as a character offset, or `null` if it is not in `root`. */
export function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  return offsetOf(root, range.startContainer, range.startOffset)
}

/** Puts the caret at a character offset, collapsing any selection. */
export function setCaret(root: HTMLElement, offset: number): void {
  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(rangeAt(root, offset))
}

/**
 * Repaints `root` and restores the caret.
 *
 * ⚠️ The caret is read **before** the repaint and reapplied after, because
 * assigning `innerHTML` destroys every node the selection pointed at — the
 * selection is then silently dropped to the start of the document and the next
 * keystroke lands at position 0. This is the single most likely way to break
 * this component.
 *
 * The caret is only restored when the element actually had it: repainting an
 * unfocused input must not steal focus, which is what would happen on a
 * background refetch while the user types somewhere else.
 */
export function repaint(
  root: HTMLElement,
  value: string,
  isDefined: (name: string) => boolean,
  caret: number | null,
): void {
  root.innerHTML = paintHtml(value, isDefined)
  if (caret !== null) setCaret(root, Math.min(caret, value.length))
}

/**
 * The caret's viewport rectangle, for anchoring the suggestion list to the
 * *caret* rather than to the field.
 *
 * ⚠️ A collapsed range reports a zero rect in some engines (and always, for an
 * empty element with no text node to measure against). Falling back to the
 * element's own box keeps the list anchored somewhere sensible instead of
 * pinning it to the top-left corner of the window.
 */
export function caretRect(root: HTMLElement): DOMRect {
  const selection = window.getSelection()
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect()
    if (rect.height > 0 || rect.width > 0) return rect
  }
  return root.getBoundingClientRect()
}

/**
 * The current selection as a pair of character offsets, or `null` when the
 * selection is not inside `root`. Needed by paste, which must replace whatever
 * is selected rather than insert beside it.
 */
export function selectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  const start = offsetOf(root, range.startContainer, range.startOffset)
  const end = offsetOf(root, range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}
