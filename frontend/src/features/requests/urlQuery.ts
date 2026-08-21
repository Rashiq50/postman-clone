import type { KeyValueEntry } from '@postman-clone/contracts'

/**
 * Two-way sync between the URL bar's query string and the Params table.
 *
 * **The URL text is canonical.** Typing in the URL bar re-derives the table
 * (`paramsFromUrl`); editing the table rewrites the URL's query section
 * (`urlWithParams`). Each direction runs once, inside the event handler that
 * caused it, as a single draft patch touching both fields — there is no effect
 * watching one field to write the other, which is what makes a feedback loop
 * (parse → serialize → reparse, rewriting the URL under the caret) impossible.
 * The URL is only ever rewritten while the user is in the *table*, so their
 * exact text in the bar — a trailing `&`, a bare `?`, a key with no `=` — is
 * never normalised away mid-keystroke.
 *
 * ⚠️ **Because every enabled row is now also in the URL, the send path must
 * pass `queryParams: []`** — the server appends the table onto whatever query
 * the URL already carries (see `ExecutionService`), so sending both doubles
 * every param. `RequestEditor.runSend` owns that; the trap is recorded there
 * too.
 *
 * ⚠️ **No `new URL()`, no decode/encode round-trips.** `{{variables}}` fail
 * `new URL()` and `encodeURIComponent` would mangle `{{` into `%7B%7B`, which
 * interpolation no longer matches. Parsing is plain string splitting on
 * `?`/`#`/`&`/first-`=` (none of which can appear inside `{{name}}`), and
 * nothing is percent-decoded — `%26` typed in the URL shows as `%26` in the
 * table and survives the round trip byte-for-byte. Serialising escapes only
 * the three delimiters (`&`, `#`, and `=` in keys) a cell value could inject.
 */

/** `base ? query # hash` — the fragment starts at the first `#`. */
function splitUrl(url: string): { base: string; query: string; hash: string } {
  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  const head = hashAt === -1 ? url : url.slice(0, hashAt)
  const queryAt = head.indexOf('?')
  if (queryAt === -1) return { base: head, query: '', hash }
  return { base: head.slice(0, queryAt), query: head.slice(queryAt + 1), hash }
}

const ESCAPES: Record<string, string> = { '&': '%26', '=': '%3D', '#': '%23' }

/** Keys escape `=` too; a value keeps it — only the *first* `=` splits. */
const escapeKey = (text: string) => text.replace(/[&=#]/g, (ch) => ESCAPES[ch])
const escapeValue = (text: string) => text.replace(/[&#]/g, (ch) => ESCAPES[ch])

/**
 * The query string as `key=value` pairs, verbatim — no decoding (see above).
 * Empty segments (`&&`, a trailing `&`) and empty keys are skipped, matching
 * the server's own `entry.key === ''` skip. A segment with no `=` is a key
 * with an empty value, so `?flag` and `?flag=` read the same.
 */
function parseQuery(query: string): Array<{ key: string; value: string }> {
  if (query === '') return []
  const pairs: Array<{ key: string; value: string }> = []
  for (const segment of query.split('&')) {
    if (segment === '') continue
    const eq = segment.indexOf('=')
    const key = eq === -1 ? segment : segment.slice(0, eq)
    if (key === '') continue
    pairs.push({ key, value: eq === -1 ? '' : segment.slice(eq + 1) })
  }
  return pairs
}

/** Enabled, non-empty-key rows as `k=v&k=v`. Order is the table's order. */
function serializeQuery(entries: KeyValueEntry[]): string {
  return entries
    .filter((entry) => entry.enabled && entry.key !== '')
    .map((entry) => `${escapeKey(entry.key)}=${escapeValue(entry.value)}`)
    .join('&')
}

/** Table → URL: replace the query section, keep base and fragment as typed. */
export function urlWithParams(url: string, entries: KeyValueEntry[]): string {
  const { base, hash } = splitUrl(url)
  const query = serializeQuery(entries)
  return query === '' ? base + hash : `${base}?${query}${hash}`
}

/**
 * URL → table: a *positional merge*, not a wholesale replace. Disabled rows
 * live only in the table (they are not in the URL), so replacing the array
 * with the parsed pairs would silently delete them. Instead the parsed pairs
 * are dealt to the enabled rows in order — updating each in place, so a
 * one-character edit in the URL edits one row rather than remounting the grid
 * — enabled rows with no pair left are dropped, disabled rows are kept where
 * they sit, and surplus pairs append as new enabled rows.
 *
 * Returns `current` untouched when nothing changed (every keystroke in the
 * path/host lands here), so the draft's `queryParams` identity is stable
 * while the query section is not being edited.
 */
export function paramsFromUrl(
  url: string,
  current: KeyValueEntry[],
): KeyValueEntry[] {
  const parsed = parseQuery(splitUrl(url).query)
  const next: KeyValueEntry[] = []
  let p = 0
  let changed = false
  for (const row of current) {
    if (!row.enabled) {
      next.push(row)
      continue
    }
    if (p >= parsed.length) {
      changed = true // enabled row no longer present in the URL
      continue
    }
    const pair = parsed[p++]
    if (pair.key === row.key && pair.value === row.value) {
      next.push(row)
    } else {
      next.push({ key: pair.key, value: pair.value, enabled: true })
      changed = true
    }
  }
  for (; p < parsed.length; p++) {
    next.push({ ...parsed[p], enabled: true })
    changed = true
  }
  return changed ? next : current
}

/**
 * Seeding: what the URL bar should show for a *stored* request.
 *
 * Rows saved before this sync existed hold their params only in the table, so
 * showing `request.url` verbatim would present a URL missing params the send
 * path will in fact append — and the first unrelated keystroke in the bar
 * would then re-derive the table from that bare URL and wipe them. So the
 * enabled rows **not already present** in the URL's own query are appended
 * once, at seed time, exactly as the server would append them. Matching is by
 * whole `key=value` pair (a multiset — duplicates count), so a row already in
 * the URL — every row saved *after* this sync — is not appended again;
 * re-opening a saved request must not grow its URL.
 */
export function seedUrl(url: string, entries: KeyValueEntry[]): string {
  const { base, query, hash } = splitUrl(url)
  const present = new Map<string, number>()
  for (const pair of parseQuery(query)) {
    const text = `${pair.key}=${pair.value}`
    present.set(text, (present.get(text) ?? 0) + 1)
  }
  const extra: string[] = []
  for (const entry of entries) {
    if (!entry.enabled || entry.key === '') continue
    const text = `${escapeKey(entry.key)}=${escapeValue(entry.value)}`
    const count = present.get(text) ?? 0
    if (count > 0) present.set(text, count - 1)
    else extra.push(text)
  }
  if (extra.length === 0) return url
  const merged = query === '' ? extra.join('&') : `${query}&${extra.join('&')}`
  return `${base}?${merged}${hash}`
}
