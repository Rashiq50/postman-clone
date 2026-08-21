import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'

/**
 * A controlled CodeMirror 6 editor.
 *
 * ## Why a dependency at all, and why this one
 *
 * The response pane needed *colour*, which is a tokenizer — see
 * [jsonSyntax.ts](../../features/requests/jsonSyntax.ts), no dependency. The
 * request body needs colour **while it is being typed into**, which is a
 * different problem: a highlight layer has to stay in register with a caret, a
 * selection, an undo history, wrapping and IME composition. The two obvious
 * cheap answers both fail on that. A transparent `<textarea>` over a mirrored
 * `<pre>` desynchronises on wrap and on composition, and presents as the app
 * dropping keystrokes. Re-highlighting a `contenteditable` moves the caret.
 *
 * CodeMirror 6 is the smallest thing that is actually correct here. Monaco was
 * the alternative considered and rejected: ~1 MB gzip against CodeMirror's
 * ~120 kB, a worker build to configure, and — decisively — it defines its
 * themes in JavaScript, which would put every syntax colour outside the CSS
 * that `check-contrast.mjs` parses. That is the same "unchecked, and invisible
 * because it is unchecked" objection recorded against a styled component kit.
 *
 * ⚠️ **The cost is recorded so it can be judged later, exactly as Radix's is:
 * six packages, measured at +311 kB raw / +102 kB gzip** (565.76/176.91 →
 * 877.12/279.25 on `yarn build`). That is three times the three Radix packages
 * combined (+101/+33), and it is the largest single dependency decision in the
 * app. Nothing else may be added on the strength of "we already have
 * CodeMirror" — no autocomplete, no lint, no search panel, no collaborative
 * editing. Each is its own decision, and each is a separate `@codemirror/*`
 * package precisely so it can be declined.
 *
 * The obvious next step if that number ever needs to come down is a lazy
 * `import()` behind `React.lazy`: the editor is one tab of five, so most
 * sessions never open it. Not done here — a suspense boundary that flashes on
 * every tab click is a worse default than 100 kB on a workbench app that is
 * already behind a login.
 *
 * ## Why it is still all tokens
 *
 * `HighlightStyle` is defined with `class:`, not `color:`, so the five syntax
 * colours resolve through the very same `--syntax-*` tokens the response pane
 * uses and `yarn contrast` audits. Everything left — the gutter, the caret, the
 * selection — is `EditorView.theme` with `var(--…)` values. There is no hex
 * literal in this file, and adding a theme still needs no edit here.
 */

/** Lezer's tags, mapped onto the app's tokens. No colour is named here. */
const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, class: 'text-syntax-key' },
  { tag: [tags.string, tags.special(tags.string)], class: 'text-syntax-string' },
  { tag: tags.number, class: 'text-syntax-number' },
  { tag: [tags.bool, tags.null, tags.keyword], class: 'text-syntax-literal' },
  {
    tag: [tags.punctuation, tags.separator, tags.brace, tags.squareBracket],
    class: 'text-syntax-punctuation',
  },
  { tag: tags.invalid, class: 'text-danger' },
])

/**
 * The chrome. `var()` throughout, so a `[data-theme]` switch repaints the
 * editor along with everything else and no JavaScript runs.
 *
 * ⚠️ The background is `transparent`, not `var(--surface)`: the editor sits
 * inside the request editor's `bg-surface` card, and on the glass theme that
 * card is translucent. Painting an opaque surface here would leave one opaque
 * rectangle in the middle of a frosted panel.
 */
const chrome = EditorView.theme({
  '&': {
    color: 'var(--fg)',
    backgroundColor: 'transparent',
    fontSize: '0.8125rem',
    height: '100%',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { padding: '0.5rem 0', caretColor: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--fg-faint)',
    border: 'none',
    paddingRight: '0.25rem',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--fg-subtle)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft)',
    color: 'inherit',
    outline: 'none',
  },
  '.cm-nonmatchingBracket': { color: 'var(--danger)' },
  '.cm-placeholder': { color: 'var(--fg-faint)' },
  '&.cm-editor .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--accent-soft)',
  },
})

export function CodeEditor({
  value,
  onChange,
  language,
  ariaLabel,
  placeholderText,
  className,
}: {
  value: string
  onChange: (value: string) => void
  /** `'json'` parses and highlights; `'text'` is a plain document. */
  language: 'json' | 'text'
  ariaLabel: string
  placeholderText?: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const languageRef = useRef(new Compartment())

  /**
   * ⚠️ `onChange` is reached through a ref, never closed over.
   *
   * The update listener is baked into the initial `EditorState` and lives as
   * long as the view does, so a captured callback would go stale the first time
   * the parent re-rendered — and the symptom is not an error but edits being
   * written into a draft object that no longer exists.
   *
   * This effect is declared *before* the one that builds the view, so the ref
   * is populated by the time anything can fire.
   */
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  /**
   * Everything the mount effect reads, behind refs so that its dependency list
   * is genuinely empty rather than suppressed with a lint comment. The seed
   * document is here too; every later change to it arrives through the sync
   * effect at the end of this component.
   */
  const seedRef = useRef({ value, ariaLabel, placeholderText })
  seedRef.current = { value, ariaLabel, placeholderText }

  // Built once. Everything that varies afterwards goes through a compartment or
  // a document dispatch — tearing the view down on a prop change would discard
  // the undo history and the caret along with it.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: seedRef.current.value,
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          indentOnInput(),
          EditorView.lineWrapping,
          syntaxHighlighting(highlightStyle),
          /*
           * ⚠️ `defaultKeymap` and `historyKeymap` only — **`indentWithTab` is
           * deliberately absent.** It makes Tab insert indentation, which turns
           * the editor into a keyboard trap: a Tab-only user reaching the body
           * field could never leave it. Tab moving focus is worth more than
           * tab-indenting a body, and Format JSON already does the indentation
           * people actually want.
           */
          keymap.of([...defaultKeymap, ...historyKeymap]),
          chrome,
          EditorView.contentAttributes.of({
            'aria-label': seedRef.current.ariaLabel,
          }),
          placeholder(seedRef.current.placeholderText ?? ''),
          languageRef.current.of([]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
        ],
      }),
    })

    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // ⚠️ Mount only, and every dependency it appears to have is read through
    // a ref or a compartment for exactly that reason. Rebuilding the view is
    // not a cheap re-render: it throws away the undo history, the caret and
    // the scroll position. `ariaLabel` and `placeholderText` are fixed per
    // call site, so they are read once here rather than bought a compartment.
  }, [])

  // Language is reconfigured in place rather than by rebuilding, so a change of
  // mode costs a re-parse and nothing else — the view, its history and its
  // scroll position survive it. (`BodyTab` happens to clear the text on a mode
  // switch of its own accord; that is its decision, not this one's.)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageRef.current.reconfigure(language === 'json' ? json() : []),
    })
  }, [language])

  /**
   * ⚠️ **The equality check is what makes this controlled component stable.**
   *
   * Every keystroke round-trips: the listener calls `onChange`, the parent
   * re-renders, and `value` comes back. Dispatching that identical text would
   * replace the whole document and collapse the selection to the end on every
   * character typed. So a write happens only when the incoming value genuinely
   * differs from the document — which is Format JSON, switching requests, and a
   * seed from the loaded draft, and nothing else.
   */
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  return <div ref={hostRef} className={className} />
}
