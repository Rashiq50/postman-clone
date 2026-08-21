/**
 * A hand-written JSON tokenizer for the response pane.
 *
 * ⚠️ **This is deliberately not an editor library, and not a grammar engine.**
 * The pane is read-only — it needs colour, not editing — and the question
 * "which dependency highlights a response body?" answers itself once you write
 * down what the pane actually renders: JSON, essentially always, already
 * `JSON.parse`d one line earlier for the Pretty toggle. Monaco is ~1 MB gzip
 * and defines its themes in JavaScript, which would put every syntax colour
 * outside the CSS that `check-contrast.mjs` parses — the same "unchecked and
 * invisible" objection recorded against a styled component kit. This file is
 * ~120 lines and its colours are five ordinary tokens.
 *
 * The editor half of the same question is answered differently, and on purpose:
 * the request body *is* edited, so it uses CodeMirror 6. See
 * [CodeEditor.tsx](../../components/ui/CodeEditor.tsx).
 *
 * The scanner is **total**: it never throws and never rejects. Anything it does
 * not recognise comes back as `plain`, so a body that stopped being valid JSON
 * halfway through still renders in full, just with less colour after the break.
 */

export type SyntaxKind =
  | 'key'
  | 'string'
  | 'number'
  | 'literal'
  | 'punctuation'
  /** Whitespace and anything unrecognised: rendered as a bare text node. */
  | 'plain'

export interface SyntaxToken {
  readonly kind: SyntaxKind
  readonly text: string
}

/**
 * The Tailwind class each kind renders as. `plain` has none — it is emitted as
 * a text node rather than a `<span>`, which is most of what keeps the node
 * count down, since indentation is the single most common thing in a
 * prettified document.
 */
export const SYNTAX_CLASS: Record<Exclude<SyntaxKind, 'plain'>, string> = {
  key: 'text-syntax-key',
  string: 'text-syntax-string',
  number: 'text-syntax-number',
  literal: 'text-syntax-literal',
  punctuation: 'text-syntax-punctuation',
}

/**
 * Above this, the pane renders the plain `<pre>` it always did.
 *
 * ⚠️ **The cap is the whole performance story, and it is not about the
 * scanner.** Measured on a 423 kB prettified array of 4,000 objects, this pass
 * takes ~18ms and is linear; it would stay comfortable well past a megabyte.
 * What does not is asking React to reconcile — and the browser to lay out —
 * one `<span>` per coloured token. That same payload is 84,000 spans; 100 kB
 * of it is ~20,000, which mounts fast enough not to be felt. Raising the cap
 * buys colour on responses nobody reads top-to-bottom anyway, and pays for it
 * with a visible freeze on the one interaction the user just triggered by
 * hand.
 *
 * The pane says so when it declines, rather than silently dropping colour: a
 * reader who sees highlighting on one response and not the next would
 * otherwise reasonably conclude the second one is not JSON.
 */
export const HIGHLIGHT_MAX_CHARS = 100_000

const PUNCTUATION = new Set(['{', '}', '[', ']', ',', ':'])
const LITERALS = ['true', 'false', 'null']

const isWhitespace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r'
const isDigit = (c: string) => c >= '0' && c <= '9'
/** The characters that may appear *inside* a JSON number, once one has begun. */
const isNumberPart = (c: string) =>
  isDigit(c) || c === '.' || c === 'e' || c === 'E' || c === '+' || c === '-'

/** A string is a key when the next non-whitespace character after it is `:`. */
function isKeyAt(source: string, after: number): boolean {
  let i = after
  while (i < source.length && isWhitespace(source[i])) i++
  return source[i] === ':'
}

export function tokenizeJson(source: string): SyntaxToken[] {
  const spans: Array<{ kind: SyntaxKind; start: number; end: number }> = []
  const n = source.length
  let i = 0

  while (i < n) {
    const c = source[i]
    const start = i

    if (c === '"') {
      i++
      while (i < n) {
        const d = source[i]
        // A backslash consumes whatever follows it, `\"` included. Stepping by
        // two is also what makes a trailing `\` at EOF terminate the loop
        // rather than spin on it.
        if (d === '\\') {
          i += 2
          continue
        }
        i++
        if (d === '"') break
      }
      spans.push({ kind: isKeyAt(source, i) ? 'key' : 'string', start, end: Math.min(i, n) })
      continue
    }

    if (isDigit(c) || (c === '-' && isDigit(source[i + 1]))) {
      i++
      while (i < n && isNumberPart(source[i])) i++
      spans.push({ kind: 'number', start, end: i })
      continue
    }

    if (PUNCTUATION.has(c)) {
      spans.push({ kind: 'punctuation', start, end: i + 1 })
      i++
      continue
    }

    const literal = LITERALS.find((word) => source.startsWith(word, i))
    if (literal) {
      i += literal.length
      spans.push({ kind: 'literal', start, end: i })
      continue
    }

    if (isWhitespace(c)) {
      while (i < n && isWhitespace(source[i])) i++
      spans.push({ kind: 'plain', start, end: i })
      continue
    }

    // Unrecognised. One character at a time is fine because the merge below
    // folds the run back into a single token.
    i++
    spans.push({ kind: 'plain', start, end: i })
  }

  // Merge adjacent runs of one kind. Punctuation and whitespace alternate
  // constantly in prettified JSON (`},\n    "` is four spans), so this is worth
  // roughly a third of the nodes for one linear pass.
  const tokens: SyntaxToken[] = []
  for (let s = 0; s < spans.length; ) {
    const { kind, start } = spans[s]
    let end = spans[s].end
    s++
    while (s < spans.length && spans[s].kind === kind) {
      end = spans[s].end
      s++
    }
    tokens.push({ kind, text: source.slice(start, end) })
  }
  return tokens
}
