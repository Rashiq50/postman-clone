import type { ResponseBodyPayload, ResponseHeader } from '@raven/contracts'

/**
 * The pure half of the response toolbar: what a response is called when it is
 * saved to disk, how it is turned into a file, and how its headers read as
 * text.
 *
 * ⚠️ Split out of [ResponseActions.tsx](ResponseActions.tsx) rather than living
 * beside the buttons, because a module that exports both components and plain
 * functions breaks Vite's fast refresh for the whole file — `oxlint`'s
 * `only-export-components` is the warning, and the frontend lint is kept clean.
 */

/**
 * The extension a saved response should carry, from its `Content-Type`.
 *
 * The map is short on purpose. Guessing wrong is worse than being generic: a
 * `.json` that will not parse sends the reader to a text editor anyway, whereas
 * `.txt` never lies about what is inside.
 */
const EXTENSIONS: [test: RegExp, extension: string][] = [
  [/json/, 'json'],
  [/html/, 'html'],
  [/xml/, 'xml'],
  [/csv/, 'csv'],
  [/javascript/, 'js'],
  [/css/, 'css'],
  [/^text\//, 'txt'],
]

export function contentTypeOf(headers: ResponseHeader[]): string {
  return (
    headers.find((header) => header.name.toLowerCase() === 'content-type')
      ?.value ?? ''
  )
}

function extensionFor(contentType: string, binary: boolean): string {
  const type = contentType.split(';')[0].trim().toLowerCase()
  const hit = EXTENSIONS.find(([test]) => test.test(type))
  if (hit) return hit[1]
  // `image/png` → `png`, `application/pdf` → `pdf`. Only for a subtype that is
  // already a plausible extension; anything with a `+suffix`, a vendor prefix
  // or a space falls through to the generic.
  const subtype = type.split('/')[1]
  if (subtype && /^[a-z0-9]{1,6}$/.test(subtype)) return subtype
  return binary ? 'bin' : 'txt'
}

/**
 * The download, shared by this toolbar and the binary body's own button so
 * there is exactly one implementation of the object-URL dance.
 *
 * ⚠️ The URL is built at click time and revoked immediately. One created during
 * render would leak an object URL per render, for a pane most people never
 * download from.
 */
export function downloadResponse(
  body: ResponseBodyPayload,
  headers: ResponseHeader[],
) {
  if (body.encoding === 'empty') return

  const contentType = contentTypeOf(headers)
  const binary = body.encoding === 'base64'
  const type =
    contentType.split(';')[0].trim() ||
    (binary ? 'application/octet-stream' : 'text/plain')

  const blob = binary
    ? new Blob([Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0))], {
        type,
      })
    : new Blob([body.text], { type: `${type};charset=utf-8` })

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `response.${extensionFor(contentType, binary)}`
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Headers as a copyable block, in the wire format they arrived in. */
export function headersAsText(headers: ResponseHeader[]): string {
  return headers.map((header) => `${header.name}: ${header.value}`).join('\n')
}
