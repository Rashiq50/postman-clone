/**
 * The response status pill, beside [methodStyles](../tree/methodStyles.ts).
 *
 * Semantic tokens only — never a Tailwind palette utility. A `bg-blue-100`
 * here would pin the pill to light mode for ever and generate no warning of
 * any kind; the rule is enforced by review rather than the compiler precisely
 * because the failure is invisible until someone switches theme.
 *
 * The only new colour family Send needed is **`info`**, and only its *soft*
 * pair: nothing here is a filled info button, and an unused solid token is one
 * more thing to retune in five theme blocks.
 */
export function statusStyle(status: number): string {
  if (status >= 200 && status < 300) {
    return 'bg-success-soft text-success-soft-fg'
  }
  if (status >= 300 && status < 400) return 'bg-info-soft text-info-soft-fg'
  if (status >= 400 && status < 500) {
    return 'bg-warning-soft text-warning-soft-fg'
  }
  return 'bg-danger-soft text-danger-soft-fg'
}

/**
 * ⚠️ A failure is **not** a status. It shares the danger colours but must never
 * be rendered in the status pill's slot: a `0` or `—` where a status code goes
 * is the exact confusion the two-outcome contract exists to prevent.
 */
export const failureStyle = 'bg-danger-soft text-danger-soft-fg'

/** `1.2 kB`, `41.2 kB`, `3.1 MB` — the size line beside the status. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** `142 ms`, `1.42 s`. */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}
