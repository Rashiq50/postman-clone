import type { HttpMethod } from '@raven/contracts'

/**
 * The method badge colours are text-only, like every other badge in this app.
 * **No icon library**, here or anywhere in this
 * feature — the glyphs are plain text (`▸ ▾ ⋯`) and the badge is the method
 * name itself. Adding a dependency for six triangles is not a trade worth
 * making, and it would be the kind of decision that is hard to reverse.
 *
 * These are theme tokens, not palette utilities. A mid-tone emerald that reads
 * cleanly on white disappears on a black canvas, so each theme retunes the six
 * hues in `index.css` — see the `--method-*` block there. HEAD and OPTIONS
 * share `method-other` because they are the two the sidebar never needs to
 * distinguish at a glance.
 */
export const methodStyles: Record<HttpMethod, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-other',
  OPTIONS: 'text-method-other',
}
