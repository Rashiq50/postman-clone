# VariableInput — a variable-aware text input

Status: **shipped**. In the URL bar, the Params and Headers cells (keys *and*
values), the form-urlencoded body fields, and every Auth field. The raw/JSON
body textarea and the Scripts tab are deliberately excluded — see
*Not built here*.

## Why

Send has interpolated `{{variables}}` since the Send slice, and the environments
UI has let people define them for just as long. But every place a variable could
be *written* was a plain `<input>`. Nothing said that `{{baseUrl}}` resolves and
`{{id}}` does not, nothing offered the names that exist, and nothing showed what
a variable was currently worth. You found out by pressing Send and reading a
warning strip — after the request had already gone somewhere unintended, or
failed `new URL()`.

This adds one reusable component that answers all three before Send.

## What it does

- Paints every `{{placeholder}}` as a chip: **green** when the active
  environment defines it, **red** when it does not.
- Opens an autocomplete list, anchored at the caret, as soon as `{{` is typed.
  Arrow keys move, Enter or Tab accepts, Escape closes.
- On hovering a chip: the resolved value, which environment it came from, a
  Reveal for a `secret`, and an inline Edit that writes back to the environment.
- On hovering an **undefined** chip: "Not defined in *Local*" and an **Add to
  Local** button, because the alternative was opening the environments dialog,
  finding the environment, adding a row and coming back — for a name the editor
  already knew.

## Shape

```
packages/contracts/src/variables.ts        the regex, tokenize, buildVariables
  |- backend/src/execution/interpolate.ts   imports + re-exports them
  |- frontend/src/features/environments/useWorkspaceVariables.ts
       |- frontend/src/components/ui/VariableInput.tsx
            |- variableInput/caret.ts             offsets, paint, repaint
            |- variableInput/useUndoStack.ts
            |- variableInput/usePanelAnchor.ts    fixed + flip + clamp
            |- variableInput/VariableSuggestions.tsx
            |- variableInput/VariablePopover.tsx
```

Call sites, all fed `workspaceId` from `RequestEditor`, which has it from
`useParams`:

| Where | File | Notes |
|---|---|---|
| URL | `RequestUrlBar.tsx` | |
| Params, Headers | `KeyValueEditor.tsx` | key **and** value cells |
| form-urlencoded body | `KeyValueEditor.tsx` via `BodyTab` | same grid |
| Auth (5 fields) | `AuthTab.tsx` | 3 of them masked, with Show/Hide |

⚠️ **The grid's key cells get chips too, not just the values.** `applyEntries`
in `interpolate.ts` substitutes into the key as well, so highlighting one and
not the other would misreport what the send path does.

⚠️ **Every cell subscribes to the environment queries for itself** rather than
taking a resolved `Map` as a prop. Those queries are already cached by the
header's picker, so it costs a subscription and not a fetch — and a `Map` passed
down would hand every row a new prop identity on each environment edit. If a
grid ever grows to hundreds of rows, a context is the first thing to reach for.

## The decisions, and their traps

### The syntax is a shared contract, not a duplicated regex

`PLACEHOLDER`, `buildVariables`, `VariableScope` and `ResolvedVariable` moved out
of `backend/src/execution/interpolate.ts` into
`packages/contracts/src/variables.ts`, joined by a pure `tokenize()` and an
`openPlaceholderAt()` built on the same pattern. `interpolate.ts` imports and
re-exports them, so nothing else on the backend changed.

This is the `passwordProblem()` doctrine. A second regex on the client is
precisely how a chip comes to read "not defined" for a name the send path
resolves perfectly well — most obviously for `{{ baseUrl }}`, where the trim
lives in one place and one place only.

⚠️ After editing contracts, `./dev.sh contracts` — and **restart the frontend**.
The script clears the Vite dep cache on disk, but a dev server that is already
running keeps the old pre-bundled copy in memory and the new export comes back
as `buildVariables is not a function`. This bit during development.

### `contenteditable`, not an overlay mirror

The alternative was a transparent `<input>` over a pixel-matched div. The
contenteditable renders the chips in the same DOM the caret lives in, which is
what makes the suggestion list anchorable to the **caret** — a `Range` has a
rectangle, where a mirror would have to re-measure the text — and what makes a
chip a real hover target rather than a coordinate lookup. Three costs, paid
explicitly:

1. ⚠️ **React must not own the children.** The div is rendered empty and painted
   imperatively. Re-rendering spans from JSX replaces the text nodes under the
   selection and drops the caret to offset 0 on every keystroke.
2. ⚠️ **Chips are styled spans over the literal text**, never atomic
   `contenteditable={false}` widgets. That is what makes a character offset into
   the value also a character offset into the DOM, and what lets the caret sit
   *inside* a name — which autocomplete requires, since it filters on what has
   been typed so far. Atomic chips would make `{{ba` untypeable.
3. ⚠️ **Undo is re-implemented** (`useUndoStack`). Assigning `innerHTML` clears
   the browser's own history, so Ctrl+Z would otherwise do nothing at all — a
   real regression against the `<input>` it replaces, and invisible until
   someone needs it. Granularity is by pause, so undo removes a word, not a
   letter.

Also load-bearing: the caret is read **before** the repaint and reapplied after,
because `innerHTML` destroys the nodes the selection points at; composition (IME,
dead keys, autocorrect) is never repainted mid-flight, or the characters are
dropped; paste is intercepted so a multi-line clipboard collapses to one line;
and `white-space: pre` — not `nowrap`, which collapses runs of spaces and would
make the DOM value stop matching React's.

### Masking, for the Auth fields

A `contenteditable` cannot be `type="password"`, so the three secret auth fields
use `-webkit-text-security: disc` behind a `secret` prop, plus a Show/Hide
toggle mirroring the one on `LoginPage` down to its `aria-pressed` and
`aria-controls` wiring.

⚠️ This trades away nothing, and the reason is already written down: `AuthTab`
records that its masking is **cosmetic only** — `GET /requests/:id` hands the
token back in plaintext regardless. A CSS mask is exactly as strong as the input
type it replaces.

⚠️ **A chip's background survives the mask, on purpose.** A row of dots tells you
nothing about whether your credential is a literal or a `{{variable}}`, and that
is precisely the thing worth knowing about a field you cannot read — sending the
literal string `{{authToken}}` as a bearer token is the failure this prevents.
A bearer token is also the single most likely value in the editor to *be* a
variable, since it is the one nobody wants committed to a shared collection.

### No new dependency

Both floating panels use the `NodeMenu.tsx` pattern — `position: fixed` from a
`getBoundingClientRect()`, measured after mount, flipped above when there is no
room below, clamped inside the viewport, dismissed on capture-phase scroll and
resize — extracted into `usePanelAnchor`. ⚠️ `fixed` is not optional: the
editor's panes are scroll containers and the next call sites (`KeyValueEditor`'s
cells) sit inside an `overflow-x-auto` table, either of which clips an absolute
panel into invisibility. `NodeMenu` keeps its own copy; it is the tree's
memoization-sensitive hot path and not worth disturbing.

Radix Popover would have cost ~15 kB gzip and still could not anchor to a caret
without a virtual element.

### Colour

Green for resolved, red for unresolved, both from tokens `check-contrast.mjs`
already audits (`success-soft-fg on success-soft`, `danger-soft-fg on
danger-soft`) in all five themes. Deliberately **not** the accent for resolved:
this is a verdict, not a highlight, and the accent is the app's "this is
interactive" colour. No new token, so no new `PAIRS` entry.

### Everything else

- The suggestion list **never takes focus** — the caret has to stay in the
  field, so the input drives it via `aria-activedescendant` and the rows use
  `onMouseDown` with `preventDefault`, mousedown being what would blur.
- A secret's value is **not previewed in the list**, only in the popover behind
  a Reveal: the list appears unbidden, over whoever's shoulder is there.
- The popover's inline edit writes the **whole** `variables` array — the
  endpoint replaces the jsonb column wholesale, so two people editing one
  environment is last-write-wins, the same as the environments dialog.
- ⚠️ `withVariable` replaces the **last** row with a given key, not the first:
  within one environment the last duplicate wins, so editing the first of two
  would appear to do nothing.
- The open and close hover delays are a pair — without the close delay the
  popover vanishes as the pointer crosses the gap toward it, and its buttons are
  unreachable.

## Not built here

- **The raw/JSON body textarea.** A multi-line variant is a genuinely different
  problem — wrapping, vertical scroll sync, and a paste that must *not* collapse
  newlines, which is the opposite of what the single-line field does. Variables
  still interpolate into the body when sent; they are simply not highlighted
  while you type it.
- **The Scripts tab.** Scripts are stored and never executed, so a `{{var}}`
  there is interpolated by nothing and a chip claiming otherwise would be a
  lie. Its banner stays until a sandbox exists.
- **Collection and global scopes.** `buildVariables` takes an ordered list and
  only `environment` is ever passed; both sides keep that shape so a new scope
  is one array entry, not a rewrite.

## Verification

`tokenize` and `openPlaceholderAt` are covered in
`backend/src/execution/interpolate.spec.ts`, deliberately **next to**
`interpolateRequest` rather than in a file of their own: the property that
matters is not that either works alone but that a chip is drawn around exactly
the span the send path would replace. The frontend has no test runner, so that
is the only place the agreement can be asserted.

The rest was verified by driving the running app: autocomplete offering and
completing `{{baseUrl}}`, chips flipping green and red as the name is edited,
the popover's Add writing into the environment and the chip turning green
without disturbing the field, a real Send resolving `{{baseUrl}}/todos/{{todoId}}`
against the backend, caret integrity under Home, typing and undo, and all five
themes.
