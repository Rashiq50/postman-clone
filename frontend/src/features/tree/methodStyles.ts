import type { HttpMethod } from '@postman-clone/contracts'

/**
 * The method badge colours, following the precedent of `TaskItem.tsx`'s
 * text-only status badges. **No icon library**, here or anywhere in this
 * feature — the glyphs are plain text (`▸ ▾ ⋯`) and the badge is the method
 * name itself. Adding a dependency for six triangles is not a trade worth
 * making, and it would be the kind of decision that is hard to reverse.
 */
export const methodStyles: Record<HttpMethod, string> = {
  GET: 'text-emerald-700',
  POST: 'text-amber-700',
  PUT: 'text-blue-700',
  PATCH: 'text-violet-700',
  DELETE: 'text-red-700',
  HEAD: 'text-slate-500',
  OPTIONS: 'text-slate-500',
}
